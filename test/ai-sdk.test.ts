import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { genAIMiddleware, instrumentAISDKModel } from "../src/index.js";
import {
  attr,
  drainReadable,
  setupOtel,
  type OtelHarness,
} from "./helpers.js";
import {
  AISDK_V2_GENERATE_RESULT,
  fakeAISDKModelV1,
  fakeAISDKModelV2,
} from "./fakes.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
});

afterEach(async () => {
  await otel.teardown();
});

const V2_PARAMS = {
  prompt: [
    { role: "user", content: [{ type: "text", text: "Say hi" }] },
  ],
  temperature: 0.5,
  maxOutputTokens: 200,
  topP: 0.8,
  seed: 7,
  stopSequences: ["STOP"],
};

describe("genAIMiddleware (Vercel AI SDK)", () => {
  it("wrapGenerate emits a semconv chat span", async () => {
    const model = fakeAISDKModelV2();
    const middleware = genAIMiddleware();

    const result = await middleware.wrapGenerate({
      doGenerate: () => model.doGenerate(V2_PARAMS),
      params: V2_PARAMS,
      model,
    });

    expect(result).toBe(AISDK_V2_GENERATE_RESULT);
    const span = otel.span();
    expect(span.name).toBe("chat gpt-4o");
    expect(attr(span, "gen_ai.operation.name")).toBe("chat");
    expect(attr(span, "gen_ai.provider.name")).toBe("openai");
    expect(attr(span, "gen_ai.request.model")).toBe("gpt-4o");
    expect(attr(span, "gen_ai.request.temperature")).toBe(0.5);
    expect(attr(span, "gen_ai.request.max_tokens")).toBe(200);
    expect(attr(span, "gen_ai.request.top_p")).toBe(0.8);
    expect(attr(span, "gen_ai.request.seed")).toBe(7);
    expect(attr(span, "gen_ai.request.stop_sequences")).toEqual(["STOP"]);
    expect(attr(span, "gen_ai.response.id")).toBe("aisdk-resp-1");
    expect(attr(span, "gen_ai.response.model")).toBe("gpt-4o-2024-08-06");
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["stop"]);
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(7);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(9);
  });

  it("wrapStream instruments the ReadableStream of parts", async () => {
    const model = fakeAISDKModelV2();
    const middleware = genAIMiddleware();

    const result = (await middleware.wrapStream({
      doStream: () => model.doStream(V2_PARAMS),
      params: V2_PARAMS,
      model,
    })) as { stream: ReadableStream<unknown> };

    expect(otel.spans()).toHaveLength(0);
    const parts = await drainReadable(result.stream);
    expect(parts).toHaveLength(7); // all parts pass through untouched

    const span = otel.span();
    expect(span.name).toBe("chat gpt-4o");
    expect(attr(span, "gen_ai.response.id")).toBe("aisdk-resp-2");
    expect(attr(span, "gen_ai.response.model")).toBe("gpt-4o-2024-08-06");
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["stop"]);
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(4);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(11);
  });

  it("fails the span when generation throws", async () => {
    const model = fakeAISDKModelV2({ generateError: new Error("bad key") });
    const middleware = genAIMiddleware();

    await expect(
      middleware.wrapGenerate({
        doGenerate: () => model.doGenerate(V2_PARAMS),
        params: V2_PARAMS,
        model,
      }),
    ).rejects.toThrow("bad key");

    const span = otel.span();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(attr(span, "error.type")).toBe("Error");
  });
});

describe("instrumentAISDKModel", () => {
  it("wraps doGenerate on a V2 model via proxy", async () => {
    const model = instrumentAISDKModel(fakeAISDKModelV2());
    await model.doGenerate(V2_PARAMS);

    const span = otel.span();
    expect(span.name).toBe("chat gpt-4o");
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(7);
    // Underlying model surface is preserved.
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("openai.chat");
    expect(model.specificationVersion).toBe("v2");
  });

  it("wraps doStream on a V2 model via proxy", async () => {
    const model = instrumentAISDKModel(fakeAISDKModelV2());
    const { stream } = (await model.doStream(V2_PARAMS)) as {
      stream: ReadableStream<unknown>;
    };
    await drainReadable(stream);

    const span = otel.span();
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(11);
  });

  it("normalizes V1 usage names (promptTokens/completionTokens)", async () => {
    const model = instrumentAISDKModel(fakeAISDKModelV1());
    await model.doGenerate({ prompt: "hi", maxTokens: 50 });

    const span = otel.span();
    expect(span.name).toBe("chat claude-3-5-haiku-latest");
    expect(attr(span, "gen_ai.provider.name")).toBe("anthropic");
    expect(attr(span, "gen_ai.request.max_tokens")).toBe(50);
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(3);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(6);
  });

  it("handles V1 stream part shapes (textDelta)", async () => {
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "true";
    try {
      const model = instrumentAISDKModel(fakeAISDKModelV1());
      const { stream } = (await model.doStream({ prompt: "hi" })) as {
        stream: ReadableStream<unknown>;
      };
      await drainReadable(stream);

      const span = otel.span();
      expect(attr(span, "gen_ai.usage.input_tokens")).toBe(2);
      expect(attr(span, "gen_ai.usage.output_tokens")).toBe(4);
      const output = JSON.parse(String(attr(span, "gen_ai.output.messages")));
      expect(output[0].parts[0].content).toBe("Hi v1");
    } finally {
      delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
    }
  });

  it("is idempotent", async () => {
    const model = instrumentAISDKModel(instrumentAISDKModel(fakeAISDKModelV2()));
    await model.doGenerate(V2_PARAMS);
    expect(otel.spans()).toHaveLength(1);
  });
});
