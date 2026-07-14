import { asyncStream, readableStream } from "./helpers.js";

// ---------------------------------------------------------------------------
// OpenAI-shaped fake client
// ---------------------------------------------------------------------------

export const OPENAI_CHAT_RESPONSE = {
  id: "chatcmpl-abc123",
  object: "chat.completion",
  created: 1_750_000_000,
  model: "gpt-4o-mini-2024-07-18",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello from fake OpenAI!" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
};

export const OPENAI_CHAT_CHUNKS = [
  {
    id: "chatcmpl-abc123",
    model: "gpt-4o-mini-2024-07-18",
    choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }],
  },
  {
    id: "chatcmpl-abc123",
    model: "gpt-4o-mini-2024-07-18",
    choices: [{ index: 0, delta: { content: "lo!" } }],
  },
  {
    id: "chatcmpl-abc123",
    model: "gpt-4o-mini-2024-07-18",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  },
  {
    id: "chatcmpl-abc123",
    model: "gpt-4o-mini-2024-07-18",
    choices: [],
    usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
  },
];

export const OPENAI_RESPONSES_RESPONSE = {
  id: "resp_67890",
  object: "response",
  model: "gpt-4o-2024-08-06",
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello from responses API" }],
    },
  ],
  usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
};

export const OPENAI_EMBEDDINGS_RESPONSE = {
  object: "list",
  model: "text-embedding-3-small",
  data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
  usage: { prompt_tokens: 4, total_tokens: 4 },
};

export interface FakeOpenAIOptions {
  chatError?: Error;
  chatChunks?: unknown[];
  streamError?: Error;
}

export function fakeOpenAI(opts: FakeOpenAIOptions = {}) {
  const calls: { chat: unknown[]; responses: unknown[]; embeddings: unknown[] } =
    { chat: [], responses: [], embeddings: [] };
  const client = {
    baseURL: "https://api.openai.com/v1",
    calls,
    chat: {
      completions: {
        async create(body: Record<string, unknown>) {
          calls.chat.push(body);
          if (opts.chatError) throw opts.chatError;
          if (body.stream === true) {
            return asyncStream(
              opts.chatChunks ?? OPENAI_CHAT_CHUNKS,
              opts.streamError,
            );
          }
          return OPENAI_CHAT_RESPONSE;
        },
      },
    },
    responses: {
      async create(body: Record<string, unknown>) {
        calls.responses.push(body);
        if (body.stream === true) {
          return asyncStream([
            {
              type: "response.created",
              response: { id: "resp_67890", model: "gpt-4o-2024-08-06" },
            },
            { type: "response.output_text.delta", delta: "Hello" },
            { type: "response.completed", response: OPENAI_RESPONSES_RESPONSE },
          ]);
        }
        return OPENAI_RESPONSES_RESPONSE;
      },
    },
    embeddings: {
      async create(body: Record<string, unknown>) {
        calls.embeddings.push(body);
        return OPENAI_EMBEDDINGS_RESPONSE;
      },
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// Anthropic-shaped fake client
// ---------------------------------------------------------------------------

export const ANTHROPIC_MESSAGE_RESPONSE = {
  id: "msg_01XYZ",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5-20250929",
  content: [{ type: "text", text: "Hello from fake Claude!" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 25 },
};

export const ANTHROPIC_STREAM_EVENTS = [
  {
    type: "message_start",
    message: {
      id: "msg_01XYZ",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      content: [],
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "stream!" } },
  { type: "content_block_stop", index: 0 },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 25 },
  },
  { type: "message_stop" },
];

/** Minimal stand-in for Anthropic's MessageStream event helper. */
export class FakeMessageStream {
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, cb: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
}

export interface FakeAnthropicOptions {
  createError?: Error;
  streamEvents?: unknown[];
}

export function fakeAnthropic(opts: FakeAnthropicOptions = {}) {
  const lastStream: { current?: FakeMessageStream } = {};
  const client = {
    baseURL: "https://api.anthropic.com",
    lastStream,
    messages: {
      async create(body: Record<string, unknown>) {
        if (opts.createError) throw opts.createError;
        if (body.stream === true) {
          return asyncStream(opts.streamEvents ?? ANTHROPIC_STREAM_EVENTS);
        }
        return ANTHROPIC_MESSAGE_RESPONSE;
      },
      stream(_body: Record<string, unknown>) {
        const stream = new FakeMessageStream();
        lastStream.current = stream;
        return stream;
      },
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// Vercel AI SDK-shaped fake language models
// ---------------------------------------------------------------------------

export const AISDK_V2_GENERATE_RESULT = {
  content: [{ type: "text", text: "Hello from fake AI SDK v2" }],
  finishReason: "stop",
  usage: { inputTokens: 7, outputTokens: 9, totalTokens: 16 },
  response: { id: "aisdk-resp-1", modelId: "gpt-4o-2024-08-06" },
  warnings: [],
};

export const AISDK_V2_STREAM_PARTS = [
  { type: "stream-start", warnings: [] },
  { type: "response-metadata", id: "aisdk-resp-2", modelId: "gpt-4o-2024-08-06" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Hello " },
  { type: "text-delta", id: "t1", delta: "stream" },
  { type: "text-end", id: "t1" },
  {
    type: "finish",
    finishReason: "stop",
    usage: { inputTokens: 4, outputTokens: 11, totalTokens: 15 },
  },
];

export interface FakeModelOptions {
  generateError?: Error;
  streamParts?: unknown[];
}

/** LanguageModelV2-shaped fake. */
export function fakeAISDKModelV2(opts: FakeModelOptions = {}) {
  return {
    specificationVersion: "v2",
    provider: "openai.chat",
    modelId: "gpt-4o",
    supportedUrls: {},
    async doGenerate(_params: unknown) {
      if (opts.generateError) throw opts.generateError;
      return AISDK_V2_GENERATE_RESULT;
    },
    async doStream(_params: unknown) {
      return {
        stream: readableStream(opts.streamParts ?? AISDK_V2_STREAM_PARTS),
        request: {},
        response: {},
      };
    },
  };
}

/** LanguageModelV1-shaped fake (AI SDK 3/4): prompt/completion token names. */
export function fakeAISDKModelV1() {
  return {
    specificationVersion: "v1",
    provider: "anthropic.messages",
    modelId: "claude-3-5-haiku-latest",
    defaultObjectGenerationMode: "tool",
    async doGenerate(_params: unknown) {
      return {
        text: "Hello from fake AI SDK v1",
        finishReason: "stop",
        usage: { promptTokens: 3, completionTokens: 6 },
        response: { id: "aisdk-v1-resp", modelId: "claude-3-5-haiku-20241022" },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream(_params: unknown) {
      return {
        stream: readableStream([
          { type: "text-delta", textDelta: "Hi " },
          { type: "text-delta", textDelta: "v1" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { promptTokens: 2, completionTokens: 4 },
          },
        ]),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// MCP-shaped fake client
// ---------------------------------------------------------------------------

export interface FakeMCPOptions {
  toolError?: Error;
  toolIsError?: boolean;
}

export function fakeMCPClient(opts: FakeMCPOptions = {}) {
  return {
    async callTool(params: Record<string, unknown>) {
      if (opts.toolError) throw opts.toolError;
      return {
        content: [{ type: "text", text: `ran ${String(params.name)}` }],
        ...(opts.toolIsError ? { isError: true } : {}),
      };
    },
    async listTools() {
      return { tools: [{ name: "get_weather" }] };
    },
    async readResource(_params: Record<string, unknown>) {
      return { contents: [{ uri: "file:///demo.txt", text: "demo" }] };
    },
    async getPrompt(_params: Record<string, unknown>) {
      return { messages: [] };
    },
    async listResources() {
      return { resources: [] };
    },
    async listPrompts() {
      return { prompts: [] };
    },
  };
}
