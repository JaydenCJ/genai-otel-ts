/**
 * genai-otel-ts — one-line, zero-config OpenTelemetry instrumentation for
 * TypeScript AI SDK calls, emitting standard OTel GenAI semantic-convention
 * spans and metrics. No vendor lock-in: any OTLP-compatible backend works.
 */

export { instrument } from "./instrument.js";
export { instrumentOpenAI } from "./openai.js";
export { instrumentAnthropic } from "./anthropic.js";
export {
  genAIMiddleware,
  instrumentAISDKModel,
  type AISDKLanguageModelLike,
  type AISDKMiddleware,
} from "./ai-sdk.js";
export { instrumentMCPClient } from "./mcp.js";

export {
  startGenAISpan,
  withGenAISpan,
  GenAISpanHandle,
  type GenAIResponseInfo,
  type StartGenAISpanOptions,
} from "./genai-span.js";

export {
  resolveConfig,
  CAPTURE_CONTENT_ENV_VAR,
  type GenAIInstrumentationOptions,
  type GenAIMessage,
  type GenAIMessagePart,
  type GenAITextPart,
  type GenAIToolCallPart,
  type GenAIToolCallResponsePart,
} from "./types.js";

export * from "./semconv.js";
export { PKG_NAME, PKG_VERSION } from "./version.js";
