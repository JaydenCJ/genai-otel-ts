/**
 * Vercel AI SDK example.
 *
 * Prerequisites:
 *   npm install ai @ai-sdk/openai @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { genAIMiddleware, instrument } from "genai-otel-ts";

const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
sdk.start();

// Option A — the one-liner: wrap the model directly.
const model = instrument(openai("gpt-4o-mini"));

// Option B — idiomatic AI SDK middleware (identical telemetry):
// const model = wrapLanguageModel({
//   model: openai("gpt-4o-mini"),
//   middleware: genAIMiddleware(),
// });

const { text } = await generateText({
  model,
  prompt: "Write a haiku about tracing.",
});
console.log(text);

// streamText goes through the same instrumented doStream path.
const { textStream } = streamText({ model, prompt: "Count to five." });
for await (const delta of textStream) {
  process.stdout.write(delta);
}

await sdk.shutdown();
