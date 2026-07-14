import { instrumentAnthropic } from "./anthropic.js";
import {
  instrumentAISDKModel,
  type AISDKLanguageModelLike,
} from "./ai-sdk.js";
import { instrumentMCPClient } from "./mcp.js";
import { instrumentOpenAI } from "./openai.js";
import type { GenAIInstrumentationOptions } from "./types.js";

/**
 * The one-liner. Auto-detects what you hand it and instruments it with
 * OpenTelemetry GenAI semantic-convention spans and metrics:
 *
 * ```ts
 * import { instrument } from "genai-otel-ts";
 *
 * const openai    = instrument(new OpenAI());               // OpenAI SDK
 * const anthropic = instrument(new Anthropic());            // Anthropic SDK
 * const model     = instrument(openaiProvider("gpt-4o"));   // Vercel AI SDK model
 * const mcp       = instrument(new Client({ ... }));        // MCP client
 * ```
 *
 * Detection is structural (duck-typed), so OpenAI-compatible clients
 * (Azure, Groq, vLLM, Ollama, ...) work too — pass
 * `{ providerName: "groq" }` to label them correctly.
 *
 * @returns the same object (clients are patched in place; AI SDK models are
 * returned as an instrumented proxy).
 * @throws TypeError when the object doesn't look like any supported SDK.
 */
export function instrument<T>(
  target: T,
  options: GenAIInstrumentationOptions = {},
): T {
  if (target == null || typeof target !== "object") {
    throw new TypeError(
      "instrument: expected an SDK client instance or AI SDK model",
    );
  }
  const t = target as Record<string, any>;

  // Vercel AI SDK language model (LanguageModelV1/V2).
  if (
    typeof t.doGenerate === "function" &&
    typeof t.specificationVersion === "string"
  ) {
    return instrumentAISDKModel(
      target as T & AISDKLanguageModelLike,
      options,
    );
  }

  // MCP client.
  if (typeof t.callTool === "function" && typeof t.listTools === "function") {
    return instrumentMCPClient(target, options);
  }

  // OpenAI SDK (and compatibles): chat.completions / responses / embeddings.
  if (
    typeof t.chat?.completions?.create === "function" ||
    typeof t.responses?.create === "function" ||
    typeof t.embeddings?.create === "function"
  ) {
    return instrumentOpenAI(target, options);
  }

  // Anthropic SDK: messages.create (no chat.completions namespace).
  if (typeof t.messages?.create === "function") {
    return instrumentAnthropic(target, options);
  }

  throw new TypeError(
    "instrument: could not detect the SDK type. Supported: OpenAI SDK client, " +
      "Anthropic SDK client, Vercel AI SDK language model, MCP client. " +
      "Use instrumentOpenAI/instrumentAnthropic/instrumentAISDKModel/" +
      "instrumentMCPClient directly for explicit control.",
  );
}
