/**
 * OpenAI SDK example.
 *
 * Prerequisites:
 *   npm install openai @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 *   export OPENAI_API_KEY=sk-...
 *
 * Run with an OTLP endpoint (Jaeger, Grafana Tempo, Honeycomb, ...) listening
 * on http://localhost:4318, then: npx tsx examples/01-openai.ts
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import OpenAI from "openai";
import { instrument } from "genai-otel-ts";

// 1. Your normal OTel setup (any setup works — this is just one option).
const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
sdk.start();

// 2. The one-liner.
const openai = instrument(new OpenAI());

// 3. Use the SDK exactly as before — every call now emits a semconv span.
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Write a haiku about tracing." }],
});
console.log(completion.choices[0]?.message.content);

// Streaming works too; the span ends when the stream is fully consumed.
const stream = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Count to five." }],
  stream: true,
  stream_options: { include_usage: true },
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}

await sdk.shutdown();
