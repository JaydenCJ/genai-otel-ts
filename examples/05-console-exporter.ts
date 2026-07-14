/**
 * Minimal self-contained example: print GenAI spans to the console.
 * Useful for checking what the library emits without any backend.
 *
 * Prerequisites:
 *   npm install openai @opentelemetry/sdk-trace-node
 */
import {
  ConsoleSpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import OpenAI from "openai";
import { instrument } from "genai-otel-ts";

const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});
provider.register();

const openai = instrument(new OpenAI());

await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Say hi" }],
});
// The exported span (name `chat gpt-4o-mini`) with gen_ai.* attributes is
// printed to stdout.

await provider.shutdown();
