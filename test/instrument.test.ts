import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instrument } from "../src/index.js";
import { attr, setupOtel, type OtelHarness } from "./helpers.js";
import {
  fakeAISDKModelV2,
  fakeAnthropic,
  fakeMCPClient,
  fakeOpenAI,
} from "./fakes.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
});

afterEach(async () => {
  await otel.teardown();
});

describe("instrument() auto-detection", () => {
  it("detects OpenAI-shaped clients", async () => {
    const client = instrument(fakeOpenAI());
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
    expect(attr(otel.span(), "gen_ai.provider.name")).toBe("openai");
  });

  it("detects Anthropic-shaped clients", async () => {
    const client = instrument(fakeAnthropic());
    await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 16,
      messages: [],
    });
    expect(attr(otel.span(), "gen_ai.provider.name")).toBe("anthropic");
  });

  it("detects Vercel AI SDK language models", async () => {
    const model = instrument(fakeAISDKModelV2());
    await model.doGenerate({ prompt: [] });
    expect(attr(otel.span(), "gen_ai.provider.name")).toBe("openai");
    expect(otel.span().name).toBe("chat gpt-4o");
  });

  it("detects MCP clients", async () => {
    const client = instrument(fakeMCPClient());
    await client.callTool({ name: "get_weather", arguments: {} });
    expect(otel.span().name).toBe("execute_tool get_weather");
  });

  it("passes options through (providerName)", async () => {
    const client = instrument(fakeOpenAI(), { providerName: "azure.ai.openai" });
    await client.chat.completions.create({ model: "gpt-4o", messages: [] });
    expect(attr(otel.span(), "gen_ai.provider.name")).toBe("azure.ai.openai");
  });

  it("throws a helpful error for unknown objects", () => {
    expect(() => instrument({ some: "thing" })).toThrow(
      /could not detect the SDK type/,
    );
    expect(() => instrument(null as never)).toThrow(TypeError);
    expect(() => instrument(42 as never)).toThrow(TypeError);
  });
});
