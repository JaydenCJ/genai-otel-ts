import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { instrumentAnthropic } from "../src/index.js";
import { attr, drain, setupOtel, type OtelHarness } from "./helpers.js";
import { ANTHROPIC_MESSAGE_RESPONSE, fakeAnthropic } from "./fakes.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
});

afterEach(async () => {
  await otel.teardown();
});

describe("instrumentAnthropic: messages.create", () => {
  it("emits a semconv chat span for a non-streaming call", async () => {
    const client = instrumentAnthropic(fakeAnthropic());
    const result = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      temperature: 0.7,
      top_p: 0.95,
      top_k: 40,
      stop_sequences: ["Human:"],
      messages: [{ role: "user", content: "Say hi" }],
    });

    expect(result).toBe(ANTHROPIC_MESSAGE_RESPONSE);
    const span = otel.span();
    expect(span.name).toBe("chat claude-sonnet-4-5");
    expect(attr(span, "gen_ai.operation.name")).toBe("chat");
    expect(attr(span, "gen_ai.provider.name")).toBe("anthropic");
    expect(attr(span, "gen_ai.request.model")).toBe("claude-sonnet-4-5");
    expect(attr(span, "gen_ai.request.max_tokens")).toBe(1024);
    expect(attr(span, "gen_ai.request.temperature")).toBe(0.7);
    expect(attr(span, "gen_ai.request.top_p")).toBe(0.95);
    expect(attr(span, "gen_ai.request.top_k")).toBe(40);
    expect(attr(span, "gen_ai.request.stop_sequences")).toEqual(["Human:"]);
    expect(attr(span, "gen_ai.response.id")).toBe("msg_01XYZ");
    expect(attr(span, "gen_ai.response.model")).toBe(
      "claude-sonnet-4-5-20250929",
    );
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["end_turn"]);
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(10);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(25);
    expect(attr(span, "server.address")).toBe("api.anthropic.com");
  });

  it("records API errors", async () => {
    const boom = Object.assign(new Error("overloaded"), { status: 529 });
    const client = instrumentAnthropic(fakeAnthropic({ createError: boom }));
    await expect(
      client.messages.create({ model: "claude-sonnet-4-5", max_tokens: 8, messages: [] }),
    ).rejects.toThrow("overloaded");

    const span = otel.span();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(attr(span, "error.type")).toBe("529");
  });

  it("accumulates usage and stop_reason across raw stream events", async () => {
    const client = instrumentAnthropic(fakeAnthropic());
    const stream = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: "Say hi" }],
      stream: true,
    });

    expect(otel.spans()).toHaveLength(0);
    await drain(stream as AsyncIterable<unknown>);

    const span = otel.span();
    expect(span.name).toBe("chat claude-sonnet-4-5");
    expect(attr(span, "gen_ai.response.id")).toBe("msg_01XYZ");
    expect(attr(span, "gen_ai.response.model")).toBe(
      "claude-sonnet-4-5-20250929",
    );
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["end_turn"]);
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(10);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(25);
  });
});

describe("instrumentAnthropic: messages.stream helper", () => {
  it("ends the span when the MessageStream finishes", async () => {
    const client = instrumentAnthropic(fakeAnthropic());
    client.messages.stream({ model: "claude-sonnet-4-5", max_tokens: 64 });
    const emitter = client.lastStream.current!;

    expect(otel.spans()).toHaveLength(0);
    emitter.emit("finalMessage", ANTHROPIC_MESSAGE_RESPONSE);
    emitter.emit("end");

    const span = otel.span();
    expect(span.name).toBe("chat claude-sonnet-4-5");
    expect(attr(span, "gen_ai.response.id")).toBe("msg_01XYZ");
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(25);
    expect(attr(span, "gen_ai.response.finish_reasons")).toEqual(["end_turn"]);
  });

  it("fails the span when the MessageStream errors", async () => {
    const client = instrumentAnthropic(fakeAnthropic());
    client.messages.stream({ model: "claude-sonnet-4-5", max_tokens: 64 });
    client.lastStream.current!.emit("error", new Error("stream broke"));

    const span = otel.span();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("fails the span on abort", async () => {
    const client = instrumentAnthropic(fakeAnthropic());
    client.messages.stream({ model: "claude-sonnet-4-5", max_tokens: 64 });
    client.lastStream.current!.emit("abort", new Error("aborted"));

    const span = otel.span();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });
});
