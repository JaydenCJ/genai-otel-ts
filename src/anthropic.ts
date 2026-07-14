import type { Attributes } from "@opentelemetry/api";
import { GenAISpanHandle, startGenAISpan } from "./genai-span.js";
import {
  ATTR_GEN_AI_REQUEST_MAX_TOKENS,
  ATTR_GEN_AI_REQUEST_STOP_SEQUENCES,
  ATTR_GEN_AI_REQUEST_TEMPERATURE,
  ATTR_GEN_AI_REQUEST_TOP_K,
  ATTR_GEN_AI_REQUEST_TOP_P,
  GenAIOperationValues,
  GenAIProviderValues,
} from "./semconv.js";
import {
  normalizeAnthropicContent,
  normalizeAnthropicMessages,
} from "./internal/content.js";
import {
  asNumber,
  asString,
  asStringArray,
  instrumentAsyncIterable,
  isAsyncIterable,
  isInstrumented,
  markInstrumented,
  patchMethod,
  promised,
  serverAttributesFromUrl,
  setNumAttr,
  spanStreamReducer,
  type StreamReducer,
} from "./internal/util.js";
import {
  resolveConfig,
  type GenAIInstrumentationOptions,
  type GenAIMessage,
  type ResolvedConfig,
} from "./types.js";

/**
 * Instrument an Anthropic SDK client (`@anthropic-ai/sdk`) in place.
 *
 * Patches, when present:
 *  - `client.messages.create` (non-streaming and `stream: true`)
 *  - `client.messages.stream` (the `MessageStream` event helper)
 *
 * @returns the same client, for one-line usage:
 * ```ts
 * const anthropic = instrumentAnthropic(new Anthropic());
 * ```
 */
export function instrumentAnthropic<T>(
  client: T,
  options: GenAIInstrumentationOptions = {},
): T {
  if (client == null || typeof client !== "object") {
    throw new TypeError(
      "instrumentAnthropic: expected an Anthropic client instance",
    );
  }
  if (isInstrumented(client)) return client;

  const config = resolveConfig(options);
  const provider = config.providerName ?? GenAIProviderValues.ANTHROPIC;
  const serverAttrs = serverAttributesFromUrl(
    (client as { baseURL?: unknown }).baseURL,
  );
  const messages = (client as Record<string, any>).messages;

  patchCreate(messages, provider, serverAttrs, config);
  patchStreamHelper(messages, provider, serverAttrs, config);

  markInstrumented(client);
  return client;
}

// ---------------------------------------------------------------------------
// messages.create
// ---------------------------------------------------------------------------

function patchCreate(
  messages: unknown,
  provider: string,
  serverAttrs: Attributes,
  config: ResolvedConfig,
): void {
  patchMethod(messages, "create", (original) => {
    return function instrumentedCreate(...args: unknown[]) {
      const body = (args[0] ?? {}) as Record<string, unknown>;
      const handle = startSpanForBody(body, provider, serverAttrs, config);

      return promised(handle, original, args, (result) => {
        if (body.stream === true && isAsyncIterable(result)) {
          return instrumentAsyncIterable(
            result as object,
            eventStreamReducer(handle, config),
          );
        }
        handle.end(messageResponseInfo(result, config));
        return result;
      });
    };
  });
}

// ---------------------------------------------------------------------------
// messages.stream — returns a MessageStream with an event-emitter interface.
// The span ends when the stream finishes (finalMessage/end/error/abort).
// ---------------------------------------------------------------------------

function patchStreamHelper(
  messages: unknown,
  provider: string,
  serverAttrs: Attributes,
  config: ResolvedConfig,
): void {
  patchMethod(messages, "stream", (original) => {
    return function instrumentedStream(...args: unknown[]) {
      const body = (args[0] ?? {}) as Record<string, unknown>;
      const handle = startSpanForBody(body, provider, serverAttrs, config);

      let stream: unknown;
      try {
        stream = handle.runInContext(() => original(...args));
      } catch (error) {
        handle.fail(error);
        throw error;
      }

      const emitter = stream as {
        on?: (event: string, cb: (...a: unknown[]) => void) => unknown;
      };
      if (typeof emitter?.on === "function") {
        let settled = false;
        let finalInfo: ReturnType<typeof messageResponseInfo> | undefined;
        emitter.on("finalMessage", (message: unknown) => {
          finalInfo = messageResponseInfo(message, config);
        });
        emitter.on("end", () => {
          if (settled) return;
          settled = true;
          handle.end(finalInfo);
        });
        emitter.on("error", (error: unknown) => {
          if (settled) return;
          settled = true;
          handle.fail(error);
        });
        emitter.on("abort", (error: unknown) => {
          if (settled) return;
          settled = true;
          handle.fail(error ?? new Error("aborted"));
        });
        return stream;
      }

      // Duck-typed fallback: unknown stream shape that is async-iterable.
      if (isAsyncIterable(stream)) {
        return instrumentAsyncIterable(
          stream as object,
          eventStreamReducer(handle, config),
        );
      }

      // Unknown shape — end the span immediately rather than leaking it.
      handle.end();
      return stream;
    };
  });
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

function startSpanForBody(
  body: Record<string, unknown>,
  provider: string,
  serverAttrs: Attributes,
  config: ResolvedConfig,
): GenAISpanHandle {
  const attrs: Attributes = { ...serverAttrs };
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_MAX_TOKENS, body.max_tokens);
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_TEMPERATURE, body.temperature);
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_TOP_P, body.top_p);
  setNumAttr(attrs, ATTR_GEN_AI_REQUEST_TOP_K, body.top_k);
  const stop = asStringArray(body.stop_sequences);
  if (stop) attrs[ATTR_GEN_AI_REQUEST_STOP_SEQUENCES] = stop;

  const handle = startGenAISpan({
    operation: GenAIOperationValues.CHAT,
    provider,
    requestModel: asString(body.model),
    attributes: attrs,
    config,
  });
  handle.setInputMessages(normalizeAnthropicMessages(body.messages));
  handle.setSystemInstructions(body.system);
  return handle;
}

function messageResponseInfo(result: unknown, config: ResolvedConfig) {
  const r = (result ?? {}) as Record<string, unknown>;
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const stopReason = asString(r.stop_reason);
  const outputMessages: GenAIMessage[] | undefined =
    config.captureMessageContent && r.content !== undefined
      ? [
          {
            role: asString(r.role) ?? "assistant",
            parts: normalizeAnthropicContent(r.content),
            ...(stopReason ? { finish_reason: stopReason } : {}),
          },
        ]
      : undefined;
  return {
    id: asString(r.id),
    model: asString(r.model),
    finishReasons: stopReason ? [stopReason] : [],
    inputTokens: asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.output_tokens),
    outputMessages,
  };
}

interface AnthropicStreamState {
  id?: string;
  model?: string;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  text: string;
}

/** Reducer over raw Anthropic SSE events (`messages.create({stream:true})`). */
function eventStreamReducer(
  handle: GenAISpanHandle,
  config: ResolvedConfig,
): StreamReducer<unknown> {
  return spanStreamReducer<AnthropicStreamState>(
    handle,
    { text: "" },
    (state, chunk) => {
      const event = (chunk ?? {}) as Record<string, unknown>;
      switch (event.type) {
        case "message_start": {
          const message = (event.message ?? {}) as Record<string, unknown>;
          const usage = (message.usage ?? {}) as Record<string, unknown>;
          state.id = asString(message.id);
          state.model = asString(message.model);
          state.inputTokens = asNumber(usage.input_tokens);
          break;
        }
        case "content_block_delta": {
          if (config.captureMessageContent) {
            const delta = (event.delta ?? {}) as Record<string, unknown>;
            if (typeof delta.text === "string") state.text += delta.text;
          }
          break;
        }
        case "message_delta": {
          const delta = (event.delta ?? {}) as Record<string, unknown>;
          const usage = (event.usage ?? {}) as Record<string, unknown>;
          state.stopReason = asString(delta.stop_reason) ?? state.stopReason;
          state.outputTokens =
            asNumber(usage.output_tokens) ?? state.outputTokens;
          break;
        }
        default:
          break;
      }
    },
    (state) => ({
      id: state.id,
      model: state.model,
      finishReasons: state.stopReason ? [state.stopReason] : [],
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      outputMessages:
        config.captureMessageContent && state.text.length > 0
          ? [
              {
                role: "assistant",
                parts: [{ type: "text" as const, content: state.text }],
                ...(state.stopReason
                  ? { finish_reason: state.stopReason }
                  : {}),
              },
            ]
          : undefined,
    }),
  );
}
