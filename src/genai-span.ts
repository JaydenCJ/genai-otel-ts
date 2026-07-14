import {
  context,
  trace,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Context,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import {
  ATTR_ERROR_TYPE,
  ATTR_GEN_AI_INPUT_MESSAGES,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_OUTPUT_MESSAGES,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_FINISH_REASONS,
  ATTR_GEN_AI_RESPONSE_ID,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_SYSTEM,
  ATTR_GEN_AI_SYSTEM_INSTRUCTIONS,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
} from "./semconv.js";
import { recordOperationDuration, recordTokenUsage } from "./metrics.js";
import type { GenAIMessage, ResolvedConfig } from "./types.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

/** Everything a completed GenAI call can report back onto its span. */
export interface GenAIResponseInfo {
  id?: string;
  model?: string;
  finishReasons?: string[];
  inputTokens?: number;
  outputTokens?: number;
  /** Only recorded when content capture is enabled. */
  outputMessages?: GenAIMessage[];
  /** Extra attributes to set on completion (already semconv-shaped). */
  attributes?: Attributes;
}

export interface StartGenAISpanOptions {
  /** `gen_ai.operation.name`, e.g. `"chat"`, `"embeddings"`, `"execute_tool"`. */
  operation: string;
  /** `gen_ai.provider.name`, e.g. `"openai"`. */
  provider?: string;
  /** `gen_ai.request.model`. */
  requestModel?: string;
  /**
   * Explicit span name. Defaults to the semconv recommendation:
   * `"{operation} {requestModel}"`, or just `"{operation}"` when no model is
   * known.
   */
  spanName?: string;
  kind?: SpanKind;
  /** Additional request attributes, already semconv-shaped. */
  attributes?: Attributes;
  config: ResolvedConfig;
}

export function getTracer(config: ResolvedConfig): Tracer {
  return config.tracer ?? trace.getTracer(PKG_NAME, PKG_VERSION);
}

/**
 * A live GenAI span. Wraps an OTel span with GenAI-semconv-aware helpers and
 * a guaranteed exactly-once `end`, plus GenAI client metric recording.
 */
export class GenAISpanHandle {
  readonly span: Span;
  readonly context: Context;
  private readonly config: ResolvedConfig;
  private readonly startTimeMs: number;
  private readonly metricAttributes: Attributes;
  private inputTokens?: number;
  private outputTokens?: number;
  private ended = false;

  constructor(span: Span, ctx: Context, opts: StartGenAISpanOptions) {
    this.span = span;
    this.context = ctx;
    this.config = opts.config;
    this.startTimeMs = Date.now();
    this.metricAttributes = {
      [ATTR_GEN_AI_OPERATION_NAME]: opts.operation,
      ...(opts.provider ? { [ATTR_GEN_AI_PROVIDER_NAME]: opts.provider } : {}),
      ...(opts.requestModel
        ? { [ATTR_GEN_AI_REQUEST_MODEL]: opts.requestModel }
        : {}),
    };
  }

  /** Whether opt-in content capture is enabled for this call. */
  get captureContent(): boolean {
    return this.config.captureMessageContent;
  }

  /** Run `fn` with this span active, so nested spans become children. */
  runInContext<T>(fn: () => T): T {
    return context.with(this.context, fn);
  }

  setAttributes(attributes: Attributes): void {
    this.span.setAttributes(attributes);
  }

  /** Records `gen_ai.input.messages` (no-op unless content capture is on). */
  setInputMessages(messages: GenAIMessage[] | undefined): void {
    if (!this.captureContent || !messages || messages.length === 0) return;
    this.span.setAttribute(ATTR_GEN_AI_INPUT_MESSAGES, safeJson(messages));
  }

  /** Records `gen_ai.system_instructions` (no-op unless content capture is on). */
  setSystemInstructions(instructions: unknown): void {
    if (!this.captureContent || instructions == null) return;
    this.span.setAttribute(
      ATTR_GEN_AI_SYSTEM_INSTRUCTIONS,
      typeof instructions === "string" ? instructions : safeJson(instructions),
    );
  }

  /** Apply response fields to the span (does not end it). */
  setResponse(info: GenAIResponseInfo): void {
    if (info.id !== undefined) {
      this.span.setAttribute(ATTR_GEN_AI_RESPONSE_ID, info.id);
    }
    if (info.model !== undefined) {
      this.span.setAttribute(ATTR_GEN_AI_RESPONSE_MODEL, info.model);
      this.metricAttributes[ATTR_GEN_AI_RESPONSE_MODEL] = info.model;
    }
    if (info.finishReasons && info.finishReasons.length > 0) {
      this.span.setAttribute(
        ATTR_GEN_AI_RESPONSE_FINISH_REASONS,
        info.finishReasons,
      );
    }
    if (typeof info.inputTokens === "number") {
      this.inputTokens = info.inputTokens;
      this.span.setAttribute(ATTR_GEN_AI_USAGE_INPUT_TOKENS, info.inputTokens);
    }
    if (typeof info.outputTokens === "number") {
      this.outputTokens = info.outputTokens;
      this.span.setAttribute(
        ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
        info.outputTokens,
      );
    }
    if (info.attributes) {
      this.span.setAttributes(info.attributes);
    }
    if (
      this.captureContent &&
      info.outputMessages &&
      info.outputMessages.length > 0
    ) {
      this.span.setAttribute(
        ATTR_GEN_AI_OUTPUT_MESSAGES,
        safeJson(info.outputMessages),
      );
    }
  }

  /** End the span successfully, optionally applying final response fields. */
  end(info?: GenAIResponseInfo): void {
    if (this.ended) return;
    this.ended = true;
    if (info) this.setResponse(info);
    this.span.end();
    this.recordMetrics();
  }

  /** End the span as failed. */
  fail(error: unknown): void {
    if (this.ended) return;
    this.ended = true;
    const errorType = errorTypeOf(error);
    this.span.setAttribute(ATTR_ERROR_TYPE, errorType);
    if (error instanceof Error) {
      this.span.recordException(error);
      this.span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    } else {
      this.span.setStatus({ code: SpanStatusCode.ERROR });
    }
    this.span.end();
    this.recordMetrics(errorType);
  }

  private recordMetrics(errorType?: string): void {
    if (!this.config.recordMetrics) return;
    const attrs: Attributes = errorType
      ? { ...this.metricAttributes, [ATTR_ERROR_TYPE]: errorType }
      : this.metricAttributes;
    recordOperationDuration((Date.now() - this.startTimeMs) / 1000, attrs);
    recordTokenUsage(this.inputTokens, this.outputTokens, attrs);
  }
}

/**
 * Start a GenAI client span following the semconv naming rule
 * `"{gen_ai.operation.name} {gen_ai.request.model}"`.
 */
export function startGenAISpan(opts: StartGenAISpanOptions): GenAISpanHandle {
  const tracer = getTracer(opts.config);
  const name =
    opts.spanName ??
    (opts.requestModel ? `${opts.operation} ${opts.requestModel}` : opts.operation);

  const attributes: Attributes = {
    [ATTR_GEN_AI_OPERATION_NAME]: opts.operation,
    ...opts.attributes,
  };
  if (opts.provider) {
    attributes[ATTR_GEN_AI_PROVIDER_NAME] = opts.provider;
    if (opts.config.emitLegacyAttributes) {
      attributes[ATTR_GEN_AI_SYSTEM] = opts.provider;
    }
  }
  if (opts.requestModel) {
    attributes[ATTR_GEN_AI_REQUEST_MODEL] = opts.requestModel;
  }

  const parent = context.active();
  const span = tracer.startSpan(
    name,
    { kind: opts.kind ?? SpanKind.CLIENT, attributes },
    parent,
  );
  const ctx = trace.setSpan(parent, span);
  return new GenAISpanHandle(span, ctx, opts);
}

/**
 * Convenience wrapper: run an async operation inside a GenAI span with
 * exactly-once completion semantics.
 */
export async function withGenAISpan<T>(
  opts: StartGenAISpanOptions,
  fn: (handle: GenAISpanHandle) => Promise<T>,
): Promise<T> {
  const handle = startGenAISpan(opts);
  try {
    const result = await handle.runInContext(() => fn(handle));
    handle.end();
    return result;
  } catch (error) {
    handle.fail(error);
    throw error;
  }
}

export function errorTypeOf(error: unknown): string {
  if (error instanceof Error) {
    // Prefer HTTP status for API errors (low cardinality), else class name.
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return String(status);
    return error.name || error.constructor.name || "Error";
  }
  return "Error";
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return '"[unserializable]"';
  }
}
