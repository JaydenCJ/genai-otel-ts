import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  errorTypeOf,
  startGenAISpan,
  withGenAISpan,
} from "../src/genai-span.js";
import { resolveConfig } from "../src/types.js";
import { attr, setupOtel, type OtelHarness } from "./helpers.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
});

afterEach(async () => {
  await otel.teardown();
});

describe("startGenAISpan", () => {
  it("follows the semconv span-naming rule", () => {
    startGenAISpan({
      operation: "chat",
      requestModel: "gpt-4o",
      config: resolveConfig(),
    }).end();
    expect(otel.span().name).toBe("chat gpt-4o");
  });

  it("falls back to the bare operation name without a model", () => {
    startGenAISpan({ operation: "chat", config: resolveConfig() }).end();
    expect(otel.span().name).toBe("chat");
  });

  it("ends exactly once even when end/fail are called repeatedly", () => {
    const handle = startGenAISpan({
      operation: "chat",
      requestModel: "m",
      config: resolveConfig(),
    });
    handle.end();
    handle.end();
    handle.fail(new Error("late"));
    expect(otel.spans()).toHaveLength(1);
    expect(otel.span().status.code).not.toBe(SpanStatusCode.ERROR);
  });
});

describe("withGenAISpan", () => {
  it("resolves and ends the span on success", async () => {
    const value = await withGenAISpan(
      { operation: "chat", requestModel: "m", config: resolveConfig() },
      async (handle) => {
        handle.setResponse({ inputTokens: 1, outputTokens: 2 });
        return "ok";
      },
    );
    expect(value).toBe("ok");
    const span = otel.span();
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(1);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(2);
  });

  it("fails the span and rethrows on error", async () => {
    await expect(
      withGenAISpan(
        { operation: "chat", config: resolveConfig() },
        async () => {
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow("nope");
    expect(otel.span().status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe("errorTypeOf", () => {
  it("prefers numeric HTTP status", () => {
    expect(errorTypeOf(Object.assign(new Error("x"), { status: 500 }))).toBe(
      "500",
    );
  });
  it("falls back to the error name", () => {
    expect(errorTypeOf(new TypeError("x"))).toBe("TypeError");
  });
  it("handles non-Error values", () => {
    expect(errorTypeOf("boom")).toBe("Error");
  });
});
