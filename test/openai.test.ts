import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { instrumentOpenAI } from "../src/index.js";
import { attr, drain, setupOtel, type OtelHarness } from "./helpers.js";
import { fakeOpenAI, OPENAI_CHAT_RESPONSE } from "./fakes.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
});

afterEach(async () => {
  await otel.teardown();
});

describe("instrumentOpenAI: chat.completions.create", () => {
  it("emits a semconv chat span for a non-streaming call", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    const result = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hi" }],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 100,
      frequency_penalty: 0.1,
      presence_penalty: 0.3,
      seed: 42,
      stop: ["END"],
      n: 1,
    });

    expect(result).toBe(OPENAI_CHAT_RESPONSE);
    const span = otel.span();
    expect(span.name).toBe("chat gpt-4o-mini");
    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(attr(span, "gen_ai.operation.name")).toBe("chat");
    expect(attr(span, "gen_ai.provider.name")).toBe("openai");
    expect(attr(span, "gen_ai.system")).toBe("openai"); // legacy alias
    expect(attr(span, "gen_ai.request.model")).toBe("gpt-4o-mini");
    expect(attr(span, "gen_ai.request.temperature")).toBe(0.2);
    expect(attr(span, "gen_ai.request.top_p")).toBe(0.9);
    expect(attr(span, "gen_ai.request.max_tokens")).toBe(100);
    expect(attr(span, "gen_ai.request.frequency_penalty")).toBe(0.1);
    expect(attr(span, "gen_ai.request.presence_penalty")).toBe(0.3);
    expect(attr(span, "gen_ai.request.seed")).toBe(42);
    expect(attr(span, "gen_ai.request.stop_sequences")).toEqual(["END"]);
    expect(attr(span, "gen_ai.request.choice.count")).toBe(1);
    expect(attr(span, "gen_ai.response.id")).toBe("chatcmpl-abc123");
    expect(attr(span, "gen_ai.response.model")).toBe(
      "gpt-4o-mini-2024-07-18",
    );
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["stop"]);
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(12);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(5);
    expect(attr(span, "server.address")).toBe("api.openai.com");
    expect(attr(span, "server.port")).toBe(443);
    // Content capture is off by default.
    expect(attr(span, "gen_ai.input.messages")).toBeUndefined();
    expect(attr(span, "gen_ai.output.messages")).toBeUndefined();
    expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it("records errors with error.type and ERROR status", async () => {
    const boom = Object.assign(new Error("rate limited"), { status: 429 });
    const client = instrumentOpenAI(fakeOpenAI({ chatError: boom }));

    await expect(
      client.chat.completions.create({ model: "gpt-4o-mini", messages: [] }),
    ).rejects.toThrow("rate limited");

    const span = otel.span();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(attr(span, "error.type")).toBe("429");
    expect(span.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("instruments streaming calls and ends the span at stream end", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hi" }],
      stream: true,
      stream_options: { include_usage: true },
    });

    // Span must not end before the stream is consumed.
    expect(otel.spans()).toHaveLength(0);

    const chunks = await drain(stream as AsyncIterable<unknown>);
    expect(chunks).toHaveLength(4);

    const span = otel.span();
    expect(span.name).toBe("chat gpt-4o-mini");
    expect(attr(span, "gen_ai.response.id")).toBe("chatcmpl-abc123");
    expect(attr(span, "gen_ai.response.model")).toBe(
      "gpt-4o-mini-2024-07-18",
    );
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["stop"]);
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(12);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(5);
  });

  it("ends the span when the consumer breaks out of the stream early", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [],
      stream: true,
    });

    for await (const _chunk of stream as AsyncIterable<unknown>) {
      break; // consume a single chunk
    }

    const span = otel.span();
    expect(span.name).toBe("chat gpt-4o-mini");
    // Usage never arrived — but the span still closed cleanly.
    expect(attr(span, "gen_ai.usage.input_tokens")).toBeUndefined();
  });

  it("fails the span when the stream errors mid-flight", async () => {
    const client = instrumentOpenAI(
      fakeOpenAI({ streamError: new Error("connection reset") }),
    );
    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [],
      stream: true,
    });

    await expect(drain(stream as AsyncIterable<unknown>)).rejects.toThrow(
      "connection reset",
    );
    const span = otel.span();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(attr(span, "error.type")).toBe("Error");
  });

  it("keeps nested spans parented under the GenAI span", async () => {
    const client = fakeOpenAI();
    const inner = client.chat.completions.create.bind(client.chat.completions);
    client.chat.completions.create = async (body: Record<string, unknown>) => {
      trace.getTracer("test").startSpan("http POST /v1/chat/completions").end();
      return inner(body);
    };
    instrumentOpenAI(client);

    await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });

    const spans = otel.spans();
    const http = spans.find((s) => s.name.startsWith("http"))!;
    const genai = spans.find((s) => s.name.startsWith("chat"))!;
    expect(http.parentSpanContext?.spanId).toBe(genai.spanContext().spanId);
    expect(http.spanContext().traceId).toBe(genai.spanContext().traceId);
  });

  it("is idempotent: double instrumentation emits a single span", async () => {
    const client = fakeOpenAI();
    instrumentOpenAI(instrumentOpenAI(client));
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
    expect(otel.spans()).toHaveLength(1);
  });

  it("honors providerName for OpenAI-compatible backends", async () => {
    const client = instrumentOpenAI(fakeOpenAI(), { providerName: "groq" });
    await client.chat.completions.create({ model: "llama-3.3-70b", messages: [] });
    const span = otel.span();
    expect(attr(span, "gen_ai.provider.name")).toBe("groq");
  });

  it("can disable the legacy gen_ai.system attribute", async () => {
    const client = instrumentOpenAI(fakeOpenAI(), {
      emitLegacyAttributes: false,
    });
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
    const span = otel.span();
    expect(attr(span, "gen_ai.provider.name")).toBe("openai");
    expect(attr(span, "gen_ai.system")).toBeUndefined();
  });
});

describe("instrumentOpenAI: responses.create", () => {
  it("emits a chat span for the Responses API", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    await client.responses.create({
      model: "gpt-4o",
      input: "Say hi",
      max_output_tokens: 64,
    });

    const span = otel.span();
    expect(span.name).toBe("chat gpt-4o");
    expect(attr(span, "gen_ai.request.max_tokens")).toBe(64);
    expect(attr(span, "gen_ai.response.id")).toBe("resp_67890");
    expect(attr(span, "gen_ai.response.model")).toBe("gpt-4o-2024-08-06");
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["completed"]);
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(20);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(8);
  });

  it("instruments streaming Responses API calls", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    const stream = await client.responses.create({
      model: "gpt-4o",
      input: "Say hi",
      stream: true,
    });
    await drain(stream as AsyncIterable<unknown>);

    const span = otel.span();
    expect(attr(span, "gen_ai.response.id")).toBe("resp_67890");
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(20);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(8);
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["completed"]);
  });
});

describe("instrumentOpenAI: embeddings.create", () => {
  it("emits an embeddings span", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    await client.embeddings.create({
      model: "text-embedding-3-small",
      input: "hello",
      encoding_format: "float",
    });

    const span = otel.span();
    expect(span.name).toBe("embeddings text-embedding-3-small");
    expect(attr(span, "gen_ai.operation.name")).toBe("embeddings");
    expect(attr(span, "gen_ai.request.encoding_formats")).toEqual(["float"]);
    expect(attr(span, "gen_ai.response.model")).toBe("text-embedding-3-small");
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(4);
  });
});
