import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instrumentAnthropic, instrumentOpenAI } from "../src/index.js";
import { attr, drain, setupOtel, type OtelHarness } from "./helpers.js";
import { fakeAnthropic, fakeOpenAI } from "./fakes.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
  delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
});

afterEach(async () => {
  delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
  await otel.teardown();
});

describe("content capture (opt-in)", () => {
  it("is disabled by default", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "secret prompt" }],
    });
    const span = otel.span();
    expect(attr(span, "gen_ai.input.messages")).toBeUndefined();
    expect(attr(span, "gen_ai.output.messages")).toBeUndefined();
  });

  it("records semconv-shaped input/output messages when enabled", async () => {
    const client = instrumentOpenAI(fakeOpenAI(), {
      captureMessageContent: true,
    });
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "Say hi" },
      ],
    });

    const span = otel.span();
    const input = JSON.parse(String(attr(span, "gen_ai.input.messages")));
    expect(input).toEqual([
      { role: "system", parts: [{ type: "text", content: "be brief" }] },
      { role: "user", parts: [{ type: "text", content: "Say hi" }] },
    ]);
    const output = JSON.parse(String(attr(span, "gen_ai.output.messages")));
    expect(output).toEqual([
      {
        role: "assistant",
        parts: [{ type: "text", content: "Hello from fake OpenAI!" }],
        finish_reason: "stop",
      },
    ]);
  });

  it("can be enabled via OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", async () => {
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "true";
    const client = instrumentOpenAI(fakeOpenAI());
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hi" }],
    });
    expect(attr(otel.span(), "gen_ai.input.messages")).toBeDefined();
  });

  it("an explicit option beats the environment variable", async () => {
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "true";
    const client = instrumentOpenAI(fakeOpenAI(), {
      captureMessageContent: false,
    });
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hi" }],
    });
    expect(attr(otel.span(), "gen_ai.input.messages")).toBeUndefined();
  });

  it("accumulates streamed OpenAI deltas into output messages", async () => {
    const client = instrumentOpenAI(fakeOpenAI(), {
      captureMessageContent: true,
    });
    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hi" }],
      stream: true,
    });
    await drain(stream as AsyncIterable<unknown>);

    const output = JSON.parse(
      String(attr(otel.span(), "gen_ai.output.messages")),
    );
    expect(output).toEqual([
      {
        role: "assistant",
        parts: [{ type: "text", content: "Hello!" }],
        finish_reason: "stop",
      },
    ]);
  });

  it("captures Anthropic system instructions and tool_use blocks", async () => {
    const client = instrumentAnthropic(fakeAnthropic(), {
      captureMessageContent: true,
    });
    await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 64,
      system: "You are terse.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "What's the weather?" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_weather",
              input: { city: "Tokyo" },
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "sunny" },
          ],
        },
      ],
    });

    const span = otel.span();
    expect(attr(span, "gen_ai.system_instructions")).toBe("You are terse.");
    const input = JSON.parse(String(attr(span, "gen_ai.input.messages")));
    expect(input[1].parts[0]).toEqual({
      type: "tool_call",
      id: "toolu_1",
      name: "get_weather",
      arguments: { city: "Tokyo" },
    });
    expect(input[2].parts[0]).toEqual({
      type: "tool_call_response",
      id: "toolu_1",
      result: "sunny",
    });
    const output = JSON.parse(String(attr(span, "gen_ai.output.messages")));
    expect(output[0].parts[0].content).toBe("Hello from fake Claude!");
  });

  it("accumulates streamed Anthropic text deltas", async () => {
    const client = instrumentAnthropic(fakeAnthropic(), {
      captureMessageContent: true,
    });
    const stream = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 64,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    await drain(stream as AsyncIterable<unknown>);

    const output = JSON.parse(
      String(attr(otel.span(), "gen_ai.output.messages")),
    );
    expect(output[0].parts[0].content).toBe("Hello stream!");
  });
});
