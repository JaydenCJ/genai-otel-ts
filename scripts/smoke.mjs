/**
 * Smoke test for the built package (dist/). Run via scripts/smoke.sh.
 *
 * Exercises the public API end-to-end against duck-typed SDK stand-ins and an
 * in-memory OpenTelemetry exporter — no network, no API keys. Asserts that
 * real GenAI semantic-convention spans and metrics come out the other side.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { context, metrics, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

// Import the *built* ESM entry point, exactly what npm consumers get.
const lib = await import("../dist/esm/index.js");
const { instrument } = lib;
assert.equal(typeof instrument, "function", "ESM build exports instrument()");

// The CJS build must load and expose the same API.
const require = createRequire(import.meta.url);
const cjs = require("../dist/cjs/index.js");
assert.equal(typeof cjs.instrument, "function", "CJS build exports instrument()");
console.log("[smoke] ESM and CJS entry points load");

// --- OTel setup: in-memory exporters, global providers -----------------------
const contextManager = new AsyncHooksContextManager().enable();
context.setGlobalContextManager(contextManager);
const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
trace.setGlobalTracerProvider(tracerProvider);
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 60 * 60 * 1000,
});
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

// --- Fresh, non-fixture inputs ----------------------------------------------
// These stand-ins mimic the SDK surfaces structurally but return data that
// exists nowhere in the repo's test fixtures.
const openaiLike = {
  baseURL: "https://api.openai.com/v1",
  chat: {
    completions: {
      async create(body) {
        if (body.stream === true) {
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                id: "chatcmpl-smoke-2",
                model: "gpt-4.1-2025-04-14",
                choices: [{ index: 0, delta: { role: "assistant", content: "str" } }],
              };
              yield {
                id: "chatcmpl-smoke-2",
                model: "gpt-4.1-2025-04-14",
                choices: [{ index: 0, delta: { content: "eam" }, finish_reason: "stop" }],
              };
              yield {
                id: "chatcmpl-smoke-2",
                model: "gpt-4.1-2025-04-14",
                choices: [],
                usage: { prompt_tokens: 41, completion_tokens: 17 },
              };
            },
          };
        }
        return {
          id: "chatcmpl-smoke-1",
          model: "gpt-4.1-2025-04-14",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "The smoke test says hi." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 23, completion_tokens: 8 },
        };
      },
    },
  },
};

const mcpLike = {
  async callTool(params) {
    return { content: [{ type: "text", text: `ok:${params.name}` }] };
  },
  async listTools() {
    return { tools: [{ name: "lookup_invoice" }] };
  },
};

// --- 1. Non-streaming chat completion ----------------------------------------
const client = instrument(openaiLike);
assert.equal(client, openaiLike, "instrument() returns the same client");
const res = await client.chat.completions.create({
  model: "gpt-4.1",
  temperature: 0.2,
  messages: [{ role: "user", content: "Summarize this invoice in one line." }],
});
assert.equal(res.choices[0].message.content, "The smoke test says hi.");

let spans = spanExporter.getFinishedSpans();
assert.equal(spans.length, 1, "one span after one call");
let span = spans[0];
assert.equal(span.name, "chat gpt-4.1");
assert.equal(span.attributes["gen_ai.operation.name"], "chat");
assert.equal(span.attributes["gen_ai.provider.name"], "openai");
assert.equal(span.attributes["gen_ai.request.model"], "gpt-4.1");
assert.equal(span.attributes["gen_ai.request.temperature"], 0.2);
assert.equal(span.attributes["gen_ai.response.model"], "gpt-4.1-2025-04-14");
assert.equal(span.attributes["gen_ai.usage.input_tokens"], 23);
assert.equal(span.attributes["gen_ai.usage.output_tokens"], 8);
assert.deepEqual(span.attributes["gen_ai.response.finish_reasons"], ["stop"]);
assert.equal(span.attributes["server.address"], "api.openai.com");
assert.equal(
  span.attributes["gen_ai.input.messages"],
  undefined,
  "content capture stays off by default",
);
console.log(`[smoke] chat span ok: '${span.name}' tokens=23/8`);

// --- 2. Streaming: span ends only after the stream is consumed ---------------
const stream = await client.chat.completions.create({
  model: "gpt-4.1",
  stream: true,
  messages: [{ role: "user", content: "Stream two words." }],
});
assert.equal(spanExporter.getFinishedSpans().length, 1, "stream span still open");
let text = "";
for await (const chunk of stream) {
  text += chunk.choices[0]?.delta?.content ?? "";
}
assert.equal(text, "stream");
spans = spanExporter.getFinishedSpans();
assert.equal(spans.length, 2, "stream span closed after consumption");
span = spans[1];
assert.equal(span.attributes["gen_ai.usage.input_tokens"], 41);
assert.equal(span.attributes["gen_ai.usage.output_tokens"], 17);
console.log(`[smoke] streaming span ok: usage from final chunk 41/17`);

// --- 3. MCP tool call ---------------------------------------------------------
const mcp = instrument(mcpLike);
await mcp.callTool({ name: "lookup_invoice", arguments: { id: "INV-42" } });
spans = spanExporter.getFinishedSpans();
span = spans[2];
assert.equal(span.name, "execute_tool lookup_invoice");
assert.equal(span.attributes["gen_ai.tool.name"], "lookup_invoice");
assert.equal(span.attributes["mcp.method.name"], "tools/call");
console.log(`[smoke] MCP tool span ok: '${span.name}'`);

// --- 4. GenAI client metrics --------------------------------------------------
await metricReader.forceFlush();
const resourceMetrics = metricExporter.getMetrics();
const names = resourceMetrics
  .flatMap((rm) => rm.scopeMetrics)
  .flatMap((sm) => sm.metrics)
  .map((m) => m.descriptor.name);
assert.ok(
  names.includes("gen_ai.client.token.usage"),
  "gen_ai.client.token.usage recorded",
);
assert.ok(
  names.includes("gen_ai.client.operation.duration"),
  "gen_ai.client.operation.duration recorded",
);
console.log("[smoke] metrics ok: token.usage + operation.duration recorded");

await tracerProvider.shutdown();
console.log("[smoke] all assertions passed");
