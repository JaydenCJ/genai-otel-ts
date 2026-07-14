import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { instrumentMCPClient } from "../src/index.js";
import { attr, setupOtel, type OtelHarness } from "./helpers.js";
import { fakeMCPClient } from "./fakes.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
});

afterEach(async () => {
  await otel.teardown();
});

describe("instrumentMCPClient", () => {
  it("emits an execute_tool span for callTool", async () => {
    const client = instrumentMCPClient(fakeMCPClient());
    const result = await client.callTool({
      name: "get_weather",
      arguments: { city: "Tokyo" },
    });

    expect(result.content[0]).toEqual({ type: "text", text: "ran get_weather" });
    const span = otel.span();
    expect(span.name).toBe("execute_tool get_weather");
    expect(attr(span, "gen_ai.operation.name")).toBe("execute_tool");
    expect(attr(span, "gen_ai.tool.name")).toBe("get_weather");
    expect(attr(span, "gen_ai.tool.type")).toBe("function");
    expect(attr(span, "mcp.method.name")).toBe("tools/call");
    expect(attr(span, "mcp.tool.name")).toBe("get_weather");
    // Content capture off by default: no arguments recorded.
    expect(attr(span, "gen_ai.tool.call.arguments")).toBeUndefined();
    expect(attr(span, "gen_ai.tool.call.result")).toBeUndefined();
  });

  it("captures tool arguments and result when content capture is on", async () => {
    const client = instrumentMCPClient(fakeMCPClient(), {
      captureMessageContent: true,
    });
    await client.callTool({ name: "get_weather", arguments: { city: "Tokyo" } });

    const span = otel.span();
    expect(JSON.parse(String(attr(span, "gen_ai.tool.call.arguments")))).toEqual({
      city: "Tokyo",
    });
    expect(
      JSON.parse(String(attr(span, "gen_ai.tool.call.result"))),
    ).toEqual([{ type: "text", text: "ran get_weather" }]);
  });

  it("marks in-band tool failures (isError=true) as span errors", async () => {
    const client = instrumentMCPClient(fakeMCPClient({ toolIsError: true }));
    await client.callTool({ name: "get_weather", arguments: {} });

    const span = otel.span();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(attr(span, "error.type")).toBe("tool_error");
  });

  it("fails the span when callTool rejects", async () => {
    const client = instrumentMCPClient(
      fakeMCPClient({ toolError: new Error("transport closed") }),
    );
    await expect(client.callTool({ name: "x" })).rejects.toThrow(
      "transport closed",
    );
    const span = otel.span();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("emits spans for readResource / getPrompt / listTools", async () => {
    const client = instrumentMCPClient(fakeMCPClient());
    await client.readResource({ uri: "file:///demo.txt" });
    await client.getPrompt({ name: "summarize" });
    await client.listTools();

    const spans = otel.spans();
    expect(spans.map((s) => s.name)).toEqual([
      "resources/read file:///demo.txt",
      "prompts/get summarize",
      "tools/list",
    ]);
    expect(attr(spans[0]!, "mcp.resource.uri")).toBe("file:///demo.txt");
    expect(attr(spans[0]!, "mcp.method.name")).toBe("resources/read");
    expect(attr(spans[1]!, "mcp.prompt.name")).toBe("summarize");
    expect(attr(spans[2]!, "mcp.method.name")).toBe("tools/list");
  });

  it("is idempotent", async () => {
    const client = fakeMCPClient();
    instrumentMCPClient(instrumentMCPClient(client));
    await client.callTool({ name: "x" });
    expect(otel.spans()).toHaveLength(1);
  });
});
