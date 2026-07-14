import type { Attributes } from "@opentelemetry/api";
import { GenAISpanHandle, startGenAISpan } from "./genai-span.js";
import {
  ATTR_GEN_AI_REQUEST_FREQUENCY_PENALTY,
  ATTR_GEN_AI_REQUEST_MAX_TOKENS,
  ATTR_GEN_AI_REQUEST_PRESENCE_PENALTY,
  ATTR_GEN_AI_REQUEST_SEED,
  ATTR_GEN_AI_REQUEST_STOP_SEQUENCES,
  ATTR_GEN_AI_REQUEST_TEMPERATURE,
  ATTR_GEN_AI_REQUEST_TOP_K,
  ATTR_GEN_AI_REQUEST_TOP_P,
  GenAIOperationValues,
} from "./semconv.js";
import {
  normalizeAISDKOutput,
  normalizeAISDKPrompt,
} from "./internal/content.js";
import {
  asNumber,
  asString,
  asStringArray,
  instrumentAsyncIterable,
  instrumentReadableStream,
  isAsyncIterable,
  isInstrumented,
  isReadableStream,
  markInstrumented,
  setNumAttr,
  spanStreamReducer,
  type StreamReducer,
} from "./internal/util.js";
import {
  resolveConfig,
  type GenAIInstrumentationOptions,
  type ResolvedConfig,
} from "./types.js";

/**
 * Structural types for the Vercel AI SDK `LanguageModel` interface. Declared
 * locally (duck-typed) so this library has no dependency on the `ai` package
 * and works with both LanguageModelV1 (AI SDK 3/4) and LanguageModelV2
 * (AI SDK 5) models.
 */
export interface AISDKLanguageModelLike {
  specificationVersion: string;
  provider: string;
  modelId: string;
  doGenerate(options: unknown): PromiseLike<unknown>;
  doStream(options: unknown): PromiseLike<unknown>;
}

/**
 * Middleware object compatible with `wrapLanguageModel({ model, middleware })`
 * from the Vercel AI SDK (v2 middleware shape; also consumable by v1's
 * `experimental_wrapLanguageModel` since the hook signatures line up).
 */
export interface AISDKMiddleware {
  middlewareVersion: "v2";
  wrapGenerate(options: {
    doGenerate: () => PromiseLike<unknown>;
    params: unknown;
    model: unknown;
  }): Promise<unknown>;
  wrapStream(options: {
    doStream: () => PromiseLike<unknown>;
    params: unknown;
    model: unknown;
  }): Promise<unknown>;
}

/**
 * Create an OpenTelemetry GenAI middleware for the Vercel AI SDK:
 *
 * ```ts
 * import { wrapLanguageModel } from "ai";
 * import { genAIMiddleware } from "genai-otel-ts";
 *
 * const model = wrapLanguageModel({
 *   model: openai("gpt-4o"),
 *   middleware: genAIMiddleware(),
 * });
 * ```
 *
 * Every `generateText` / `streamText` / `generateObject` call through the
 * wrapped model emits a semconv `chat {model}` span, with usage, finish
 * reasons and (opt-in) message content — for both generate and stream paths.
 */
export function genAIMiddleware(
  options: GenAIInstrumentationOptions = {},
): AISDKMiddleware {
  const config = resolveConfig(options);
  return {
    middlewareVersion: "v2",
    async wrapGenerate({ doGenerate, params, model }) {
      const handle = startSpanForCall(model, params, config);
      try {
        const result = await handle.runInContext(() => doGenerate());
        handle.end(generateResponseInfo(result, config));
        return result;
      } catch (error) {
        handle.fail(error);
        throw error;
      }
    },
    async wrapStream({ doStream, params, model }) {
      const handle = startSpanForCall(model, params, config);
      let result: unknown;
      try {
        result = await handle.runInContext(() => doStream());
      } catch (error) {
        handle.fail(error);
        throw error;
      }
      const r = (result ?? {}) as Record<string, unknown>;
      const reducer = streamPartReducer(handle, config);
      if (isReadableStream(r.stream)) {
        return { ...r, stream: instrumentReadableStream(r.stream, reducer) };
      }
      if (isAsyncIterable(r.stream)) {
        return {
          ...r,
          stream: instrumentAsyncIterable(r.stream as object, reducer),
        };
      }
      // Unknown stream shape: don't leak the span.
      handle.end();
      return result;
    },
  };
}

/**
 * Wrap a Vercel AI SDK language model directly (no `wrapLanguageModel`
 * import needed):
 *
 * ```ts
 * const model = instrumentAISDKModel(openai("gpt-4o"));
 * const { text } = await generateText({ model, prompt: "hi" });
 * ```
 */
export function instrumentAISDKModel<M extends AISDKLanguageModelLike>(
  model: M,
  options: GenAIInstrumentationOptions = {},
): M {
  if (isInstrumented(model)) return model;
  const middleware = genAIMiddleware(options);

  const proxied = new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === "doGenerate") {
        return (params: unknown) =>
          middleware.wrapGenerate({
            doGenerate: () => target.doGenerate.call(target, params),
            params,
            model: target,
          });
      }
      if (prop === "doStream") {
        return (params: unknown) =>
          middleware.wrapStream({
            doStream: () => target.doStream.call(target, params),
            params,
            model: target,
          });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  markInstrumented(proxied);
  return proxied;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function startSpanForCall(
  model: unknown,
  params: unknown,
  config: ResolvedConfig,
): GenAISpanHandle {
  const m = (model ?? {}) as Record<string, unknown>;
  const p = (params ?? {}) as Record<string, unknown>;
  const provider = providerNameOf(asString(m.provider), config);

  const attrs: Attributes = {};
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_TEMPERATURE, p.temperature);
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_TOP_P, p.topP);
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_TOP_K, p.topK);
  // V2 uses maxOutputTokens; V1 used maxTokens.
  setNumAttr(
    attrs,
    ATTR_GEN_AI_REQUEST_MAX_TOKENS,
    p.maxOutputTokens ?? p.maxTokens,
  );
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_FREQUENCY_PENALTY, p.frequencyPenalty);
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_PRESENCE_PENALTY, p.presencePenalty);
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_SEED, p.seed);
  const stop = asStringArray(p.stopSequences);
  if (stop) attrs[ATTR_GEN_AI_REQUEST_STOP_SEQUENCES] = stop;

  const handle = startGenAISpan({
    operation: GenAIOperationValues.CHAT,
    provider,
    requestModel: asString(m.modelId),
    attributes: attrs,
    config,
  });
  handle.setInputMessages(normalizeAISDKPrompt(p.prompt));
  return handle;
}

/**
 * AI SDK provider ids look like `"openai.chat"` / `"anthropic.messages"`;
 * the semconv provider name is the first segment.
 */
function providerNameOf(
  provider: string | undefined,
  config: ResolvedConfig,
): string | undefined {
  if (config.providerName) return config.providerName;
  if (!provider) return undefined;
  return provider.split(".")[0];
}

interface NormalizedUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Accepts both V2 ({input,output}Tokens) and V1 ({prompt,completion}Tokens). */
function normalizeUsage(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  return {
    inputTokens: asNumber(u.inputTokens ?? u.promptTokens),
    outputTokens: asNumber(u.outputTokens ?? u.completionTokens),
  };
}

function generateResponseInfo(result: unknown, config: ResolvedConfig) {
  const r = (result ?? {}) as Record<string, unknown>;
  const response = (r.response ?? {}) as Record<string, unknown>;
  const usage = normalizeUsage(r.usage);
  const finishReason = asString(r.finishReason);
  return {
    id: asString(response.id),
    model: asString(response.modelId),
    finishReasons: finishReason ? [finishReason] : [],
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    outputMessages: config.captureMessageContent
      ? normalizeAISDKOutput(r, finishReason)
      : undefined,
  };
}

interface AISDKStreamState {
  id?: string;
  model?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  text: string;
}

function streamPartReducer(
  handle: GenAISpanHandle,
  config: ResolvedConfig,
): StreamReducer<unknown> {
  return spanStreamReducer<AISDKStreamState>(
    handle,
    { text: "" },
    (state, part) => {
      const p = (part ?? {}) as Record<string, unknown>;
      switch (p.type) {
        case "response-metadata": {
          state.id = asString(p.id) ?? state.id;
          state.model = asString(p.modelId) ?? state.model;
          break;
        }
        case "text-delta": {
          if (config.captureMessageContent) {
            // V2 uses `delta`; V1 used `textDelta`.
            const delta = asString(p.delta) ?? asString(p.textDelta);
            if (delta) state.text += delta;
          }
          break;
        }
        case "finish": {
          state.finishReason = asString(p.finishReason) ?? state.finishReason;
          const usage = normalizeUsage(p.usage);
          state.inputTokens = usage.inputTokens ?? state.inputTokens;
          state.outputTokens = usage.outputTokens ?? state.outputTokens;
          break;
        }
        default:
          break;
      }
    },
    (state) => ({
      id: state.id,
      model: state.model,
      finishReasons: state.finishReason ? [state.finishReason] : [],
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      outputMessages:
        config.captureMessageContent && state.text.length > 0
          ? [
              {
                role: "assistant",
                parts: [{ type: "text" as const, content: state.text }],
                ...(state.finishReason
                  ? { finish_reason: state.finishReason }
                  : {}),
              },
            ]
          : undefined,
    }),
  );
}
