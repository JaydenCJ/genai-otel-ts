import type { Attributes } from "@opentelemetry/api";
import {
  GenAISpanHandle,
  startGenAISpan,
} from "./genai-span.js";
import {
  ATTR_GEN_AI_REQUEST_CHOICE_COUNT,
  ATTR_GEN_AI_REQUEST_ENCODING_FORMATS,
  ATTR_GEN_AI_REQUEST_FREQUENCY_PENALTY,
  ATTR_GEN_AI_REQUEST_MAX_TOKENS,
  ATTR_GEN_AI_REQUEST_PRESENCE_PENALTY,
  ATTR_GEN_AI_REQUEST_SEED,
  ATTR_GEN_AI_REQUEST_STOP_SEQUENCES,
  ATTR_GEN_AI_REQUEST_TEMPERATURE,
  ATTR_GEN_AI_REQUEST_TOP_P,
  GenAIOperationValues,
  GenAIProviderValues,
} from "./semconv.js";
import {
  normalizeOpenAIChatChoices,
  normalizeOpenAIChatMessages,
  normalizeOpenAIResponsesInput,
  normalizeOpenAIResponsesOutput,
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
  setNumAttr as setNum,
  spanStreamReducer,
} from "./internal/util.js";
import { resolveConfig, type GenAIInstrumentationOptions, type ResolvedConfig } from "./types.js";

/**
 * Instrument an OpenAI SDK client (`openai` npm package, v4/v5) in place.
 *
 * Patches, when present:
 *  - `client.chat.completions.create` (non-streaming and `stream: true`)
 *  - `client.responses.create` (non-streaming and `stream: true`)
 *  - `client.embeddings.create`
 *
 * Works with any OpenAI-compatible client object (Azure OpenAI, Groq, vLLM,
 * Ollama, ...) — set `options.providerName` to report the actual backend.
 *
 * @returns the same client, for one-line usage:
 * ```ts
 * const openai = instrumentOpenAI(new OpenAI());
 * ```
 */
export function instrumentOpenAI<T>(
  client: T,
  options: GenAIInstrumentationOptions = {},
): T {
  if (client == null || typeof client !== "object") {
    throw new TypeError("instrumentOpenAI: expected an OpenAI client instance");
  }
  if (isInstrumented(client)) return client;

  const config = resolveConfig(options);
  const provider = config.providerName ?? GenAIProviderValues.OPENAI;
  const serverAttrs = serverAttributesFromUrl(
    (client as { baseURL?: unknown }).baseURL,
  );
  const anyClient = client as Record<string, any>;

  patchChatCompletions(anyClient, provider, serverAttrs, config);
  patchResponses(anyClient, provider, serverAttrs, config);
  patchEmbeddings(anyClient, provider, serverAttrs, config);

  markInstrumented(client);
  return client;
}

// ---------------------------------------------------------------------------
// chat.completions.create
// ---------------------------------------------------------------------------

function patchChatCompletions(
  client: Record<string, any>,
  provider: string,
  serverAttrs: Attributes,
  config: ResolvedConfig,
): void {
  const completions = client.chat?.completions;
  patchMethod(completions, "create", (original) => {
    return function instrumentedCreate(...args: unknown[]) {
      const body = (args[0] ?? {}) as Record<string, unknown>;
      const handle = startGenAISpan({
        operation: GenAIOperationValues.CHAT,
        provider,
        requestModel: asString(body.model),
        attributes: { ...serverAttrs, ...chatRequestAttributes(body) },
        config,
      });
      handle.setInputMessages(normalizeOpenAIChatMessages(body.messages));

      return promised(handle, original, args, (result) => {
        if (body.stream === true && isAsyncIterable(result)) {
          return instrumentAsyncIterable(
            result as object,
            chatStreamReducer(handle, config),
          );
        }
        handle.end(chatResponseInfo(result, config));
        return result;
      });
    };
  });
}

function chatRequestAttributes(body: Record<string, unknown>): Attributes {
  const attrs: Attributes = {};
  setNum(attrs, ATTR_GEN_AI_REQUEST_TEMPERATURE, body.temperature);
  setNum(attrs, ATTR_GEN_AI_REQUEST_TOP_P, body.top_p);
  setNum(
    attrs,
    ATTR_GEN_AI_REQUEST_MAX_TOKENS,
    body.max_completion_tokens ?? body.max_tokens,
  );
  setNum(attrs, ATTR_GEN_AI_REQUEST_FREQUENCY_PENALTY, body.frequency_penalty);
  setNum(attrs, ATTR_GEN_AI_REQUEST_PRESENCE_PENALTY, body.presence_penalty);
  setNum(attrs, ATTR_GEN_AI_REQUEST_SEED, body.seed);
  setNum(attrs, ATTR_GEN_AI_REQUEST_CHOICE_COUNT, body.n);
  const stop = asStringArray(body.stop);
  if (stop) attrs[ATTR_GEN_AI_REQUEST_STOP_SEQUENCES] = stop;
  return attrs;
}

function chatResponseInfo(result: unknown, config: ResolvedConfig) {
  const r = (result ?? {}) as Record<string, unknown>;
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const choices = Array.isArray(r.choices) ? r.choices : [];
  const finishReasons = choices
    .map((c) => asString((c as Record<string, unknown>)?.finish_reason))
    .filter((v): v is string => v !== undefined);
  return {
    id: asString(r.id),
    model: asString(r.model),
    finishReasons,
    inputTokens: asNumber(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: asNumber(usage.completion_tokens ?? usage.output_tokens),
    outputMessages: config.captureMessageContent
      ? normalizeOpenAIChatChoices(r.choices)
      : undefined,
  };
}

interface ChatStreamState {
  id?: string;
  model?: string;
  finishReasons: string[];
  inputTokens?: number;
  outputTokens?: number;
  texts: Map<number, { role: string; text: string; finish?: string }>;
}

function chatStreamReducer(handle: GenAISpanHandle, config: ResolvedConfig) {
  return spanStreamReducer<ChatStreamState>(
    handle,
    { finishReasons: [], texts: new Map() },
    (state, chunk) => {
      const c = (chunk ?? {}) as Record<string, unknown>;
      state.id ??= asString(c.id);
      state.model ??= asString(c.model);
      const usage = c.usage as Record<string, unknown> | undefined;
      if (usage) {
        state.inputTokens = asNumber(usage.prompt_tokens) ?? state.inputTokens;
        state.outputTokens =
          asNumber(usage.completion_tokens) ?? state.outputTokens;
      }
      if (Array.isArray(c.choices)) {
        for (const choice of c.choices) {
          const ch = (choice ?? {}) as Record<string, unknown>;
          const index = asNumber(ch.index) ?? 0;
          const finish = asString(ch.finish_reason);
          if (finish) {
            state.finishReasons.push(finish);
            const entry = state.texts.get(index);
            if (entry) entry.finish = finish;
          }
          if (config.captureMessageContent) {
            const delta = (ch.delta ?? {}) as Record<string, unknown>;
            const entry = state.texts.get(index) ?? {
              role: asString(delta.role) ?? "assistant",
              text: "",
            };
            if (typeof delta.content === "string") {
              entry.text += delta.content;
            }
            state.texts.set(index, entry);
          }
        }
      }
    },
    (state) => ({
      id: state.id,
      model: state.model,
      finishReasons: state.finishReasons,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      outputMessages: config.captureMessageContent
        ? [...state.texts.values()].map((entry) => ({
            role: entry.role,
            parts: [{ type: "text" as const, content: entry.text }],
            ...(entry.finish ? { finish_reason: entry.finish } : {}),
          }))
        : undefined,
    }),
  );
}

// ---------------------------------------------------------------------------
// responses.create (OpenAI Responses API)
// ---------------------------------------------------------------------------

function patchResponses(
  client: Record<string, any>,
  provider: string,
  serverAttrs: Attributes,
  config: ResolvedConfig,
): void {
  patchMethod(client.responses, "create", (original) => {
    return function instrumentedCreate(...args: unknown[]) {
      const body = (args[0] ?? {}) as Record<string, unknown>;
      const attrs: Attributes = { ...serverAttrs };
      setNum(attrs, ATTR_GEN_AI_REQUEST_TEMPERATURE, body.temperature);
      setNum(attrs, ATTR_GEN_AI_REQUEST_TOP_P, body.top_p);
      setNum(attrs, ATTR_GEN_AI_REQUEST_MAX_TOKENS, body.max_output_tokens);

      const handle = startGenAISpan({
        operation: GenAIOperationValues.CHAT,
        provider,
        requestModel: asString(body.model),
        attributes: attrs,
        config,
      });
      handle.setInputMessages(normalizeOpenAIResponsesInput(body.input));
      handle.setSystemInstructions(body.instructions);

      return promised(handle, original, args, (result) => {
        if (body.stream === true && isAsyncIterable(result)) {
          return instrumentAsyncIterable(
            result as object,
            responsesStreamReducer(handle, config),
          );
        }
        handle.end(responsesResponseInfo(result, config));
        return result;
      });
    };
  });
}

function responsesResponseInfo(result: unknown, config: ResolvedConfig) {
  const r = (result ?? {}) as Record<string, unknown>;
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const incomplete = (r.incomplete_details ?? {}) as Record<string, unknown>;
  const finish = asString(incomplete.reason) ?? asString(r.status);
  return {
    id: asString(r.id),
    model: asString(r.model),
    finishReasons: finish ? [finish] : [],
    inputTokens: asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.output_tokens),
    outputMessages: config.captureMessageContent
      ? normalizeOpenAIResponsesOutput(r.output)
      : undefined,
  };
}

function responsesStreamReducer(
  handle: GenAISpanHandle,
  config: ResolvedConfig,
) {
  return spanStreamReducer<{ final?: unknown; id?: string; model?: string }>(
    handle,
    {},
    (state, chunk) => {
      const event = (chunk ?? {}) as Record<string, unknown>;
      const type = asString(event.type) ?? "";
      const response = event.response as Record<string, unknown> | undefined;
      if (type === "response.created" && response) {
        state.id = asString(response.id);
        state.model = asString(response.model);
      }
      if (
        (type === "response.completed" ||
          type === "response.incomplete" ||
          type === "response.failed") &&
        response
      ) {
        state.final = response;
      }
    },
    (state) => {
      if (state.final) return responsesResponseInfo(state.final, config);
      return { id: state.id, model: state.model };
    },
  );
}

// ---------------------------------------------------------------------------
// embeddings.create
// ---------------------------------------------------------------------------

function patchEmbeddings(
  client: Record<string, any>,
  provider: string,
  serverAttrs: Attributes,
  config: ResolvedConfig,
): void {
  patchMethod(client.embeddings, "create", (original) => {
    return function instrumentedCreate(...args: unknown[]) {
      const body = (args[0] ?? {}) as Record<string, unknown>;
      const attrs: Attributes = { ...serverAttrs };
      const format = asString(body.encoding_format);
      if (format) attrs[ATTR_GEN_AI_REQUEST_ENCODING_FORMATS] = [format];

      const handle = startGenAISpan({
        operation: GenAIOperationValues.EMBEDDINGS,
        provider,
        requestModel: asString(body.model),
        attributes: attrs,
        config,
      });

      return promised(handle, original, args, (result) => {
        const r = (result ?? {}) as Record<string, unknown>;
        const usage = (r.usage ?? {}) as Record<string, unknown>;
        handle.end({
          model: asString(r.model),
          inputTokens: asNumber(usage.prompt_tokens ?? usage.input_tokens),
        });
        return result;
      });
    };
  });
}

