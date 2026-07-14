# Examples

Runnable usage examples for `genai-otel-ts`. Each file lists its own
prerequisites at the top (the AI SDKs are peer dependencies of your app, not
of this library, so install the ones you use).

| File | Shows |
| --- | --- |
| [`01-openai.ts`](./01-openai.ts) | OpenAI SDK: chat completions, streaming, OTLP export |
| [`02-anthropic.ts`](./02-anthropic.ts) | Anthropic SDK: messages.create and the MessageStream helper |
| [`03-vercel-ai-sdk.ts`](./03-vercel-ai-sdk.ts) | Vercel AI SDK: `instrument(model)` and `genAIMiddleware()` |
| [`04-mcp.ts`](./04-mcp.ts) | MCP client: tool calls, resource reads, list operations |
| [`05-console-exporter.ts`](./05-console-exporter.ts) | Zero-backend smoke test with a console exporter |

Run any example with [tsx](https://github.com/privatenumber/tsx):

```bash
npx tsx examples/01-openai.ts
```
