# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-08

Initial release.

### Added

- `instrument(x)` — one-line, duck-typed auto-detection and in-place
  instrumentation of OpenAI SDK clients, Anthropic SDK clients, Vercel AI SDK
  language models, and MCP clients.
- **OpenAI SDK**: `chat.completions.create`, `responses.create`, and
  `embeddings.create` (non-streaming and `stream: true`), including token
  usage from `stream_options: { include_usage: true }` final chunks.
- **Anthropic SDK**: `messages.create` (non-streaming and `stream: true`) and
  the `messages.stream` MessageStream helper (span completion on
  `finalMessage`/`end`/`error`/`abort`).
- **Vercel AI SDK**: `genAIMiddleware()` for `wrapLanguageModel` and
  `instrumentAISDKModel()` proxy; supports LanguageModel V1 (AI SDK 3/4) and
  V2 (AI SDK 5) shapes with normalized usage fields, for both `doGenerate`
  and `doStream` (ReadableStream and async-iterable parts).
- **MCP clients**: `callTool` (`execute_tool {tool}` spans with GenAI + MCP
  attributes, `isError` mapped to span errors), `readResource`, `getPrompt`,
  `listTools`, `listResources`, `listPrompts`.
- GenAI semantic-convention spans: `{operation} {model}` naming,
  `gen_ai.provider.name` (+ legacy `gen_ai.system` alias, configurable),
  request parameters, response id/model/finish reasons, token usage,
  `server.address`/`server.port`, `error.type` + exception events.
- GenAI client metrics: `gen_ai.client.token.usage` and
  `gen_ai.client.operation.duration` histograms with semconv-recommended
  bucket boundaries.
- Opt-in content capture (`captureMessageContent` option or
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` env var) recording
  `gen_ai.input.messages`, `gen_ai.output.messages`,
  `gen_ai.system_instructions`, `gen_ai.tool.call.arguments`,
  `gen_ai.tool.call.result` in the semconv message shape — including
  accumulation of streamed text deltas.
- Exactly-once span completion across all streaming paths (exhaustion, early
  break, cancel, mid-stream error).
- Context propagation: GenAI spans parent to the active span; nested spans
  (e.g. underlying HTTP) become children of the GenAI span.
- Dual ESM + CommonJS build, strict TypeScript, zero runtime dependencies
  beyond the `@opentelemetry/api` peer.
- 59 unit tests over in-memory OTel exporters; no network or API keys needed.

### Roadmap

See the Roadmap section in [README.md](README.md): zero-code bootstrap
(`node --import genai-otel-ts/register`), Google GenAI SDK support,
time-to-first-token measurement, and preserving SDK promise extensions.

[0.1.0]: https://github.com/JaydenCJ/genai-otel-ts
