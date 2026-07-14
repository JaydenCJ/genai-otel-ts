/**
 * Anthropic SDK example.
 *
 * Prerequisites:
 *   npm install @anthropic-ai/sdk @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 *   export ANTHROPIC_API_KEY=sk-ant-...
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import Anthropic from "@anthropic-ai/sdk";
import { instrument } from "genai-otel-ts";

const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
sdk.start();

const anthropic = instrument(new Anthropic());

// Non-streaming — one `chat claude-...` span with usage + stop_reason.
const message = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 256,
  messages: [{ role: "user", content: "Write a haiku about tracing." }],
});
console.log(message.content);

// The MessageStream helper is instrumented as well; the span ends when the
// stream finishes (or errors / aborts).
const stream = anthropic.messages.stream({
  model: "claude-sonnet-4-5",
  max_tokens: 256,
  messages: [{ role: "user", content: "Count to five." }],
});
stream.on("text", (text) => process.stdout.write(text));
await stream.finalMessage();

await sdk.shutdown();
