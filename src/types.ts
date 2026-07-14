import type { Tracer } from "@opentelemetry/api";

/**
 * Options accepted by every `instrument*` entry point. All fields are
 * optional — the zero-config defaults work with whatever OpenTelemetry SDK
 * setup is already registered globally.
 */
export interface GenAIInstrumentationOptions {
  /**
   * Capture full prompt / completion message content on spans
   * (`gen_ai.input.messages`, `gen_ai.output.messages`,
   * `gen_ai.system_instructions`, `gen_ai.tool.call.arguments`,
   * `gen_ai.tool.call.result`).
   *
   * Message content may contain sensitive data, so this is **off by
   * default**, matching the semantic-convention guidance. It can also be
   * enabled without code changes via the environment variable
   * `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`.
   */
  captureMessageContent?: boolean;

  /**
   * Also emit the deprecated `gen_ai.system` attribute alongside the current
   * `gen_ai.provider.name`, for compatibility with observability backends
   * that still key on the old name.
   *
   * @default true
   */
  emitLegacyAttributes?: boolean;

  /**
   * Record the GenAI client metrics `gen_ai.client.token.usage` and
   * `gen_ai.client.operation.duration` in addition to spans.
   *
   * @default true
   */
  recordMetrics?: boolean;

  /**
   * Override the reported `gen_ai.provider.name`. Useful when pointing an
   * OpenAI-compatible client at another backend (Groq, Mistral, DeepSeek,
   * a local vLLM/Ollama endpoint, ...).
   */
  providerName?: string;

  /**
   * Supply an explicit tracer instead of the global
   * `trace.getTracer(...)`. Rarely needed.
   */
  tracer?: Tracer;
}

/** Resolved, defaulted configuration used internally. */
export interface ResolvedConfig {
  captureMessageContent: boolean;
  emitLegacyAttributes: boolean;
  recordMetrics: boolean;
  providerName?: string;
  tracer?: Tracer;
}

const TRUTHY = new Set(["true", "1", "yes", "on"]);

/** Environment variable that enables content capture without code changes. */
export const CAPTURE_CONTENT_ENV_VAR =
  "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT";

function envCaptureContent(): boolean {
  const raw =
    typeof process !== "undefined"
      ? process.env?.[CAPTURE_CONTENT_ENV_VAR]
      : undefined;
  return raw !== undefined && TRUTHY.has(raw.trim().toLowerCase());
}

export function resolveConfig(
  options: GenAIInstrumentationOptions = {},
): ResolvedConfig {
  return {
    captureMessageContent: options.captureMessageContent ?? envCaptureContent(),
    emitLegacyAttributes: options.emitLegacyAttributes ?? true,
    recordMetrics: options.recordMetrics ?? true,
    providerName: options.providerName,
    tracer: options.tracer,
  };
}

// ---------------------------------------------------------------------------
// Normalized message shapes used for opt-in content capture. These follow the
// structure defined for `gen_ai.input.messages` / `gen_ai.output.messages`.
// ---------------------------------------------------------------------------

export interface GenAITextPart {
  type: "text";
  content: unknown;
}

export interface GenAIToolCallPart {
  type: "tool_call";
  id?: string;
  name?: string;
  arguments?: unknown;
}

export interface GenAIToolCallResponsePart {
  type: "tool_call_response";
  id?: string;
  result?: unknown;
}

export type GenAIMessagePart =
  | GenAITextPart
  | GenAIToolCallPart
  | GenAIToolCallResponsePart;

export interface GenAIMessage {
  role: string;
  parts: GenAIMessagePart[];
  finish_reason?: string;
}
