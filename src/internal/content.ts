import type { GenAIMessage, GenAIMessagePart } from "../types.js";

/**
 * Normalizers that convert provider-specific message shapes into the
 * semconv-recommended structure recorded under `gen_ai.input.messages` /
 * `gen_ai.output.messages`:
 *
 *   [{ "role": "user", "parts": [{ "type": "text", "content": "..." }] }]
 *
 * These are only invoked when content capture is explicitly enabled.
 */

// ---------------------------------------------------------------------------
// OpenAI Chat Completions
// ---------------------------------------------------------------------------

export function normalizeOpenAIChatMessages(messages: unknown): GenAIMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    const msg = (m ?? {}) as Record<string, unknown>;
    const parts: GenAIMessagePart[] = [];
    const content = msg.content;
    if (typeof content === "string") {
      parts.push({ type: "text", content });
    } else if (Array.isArray(content)) {
      for (const item of content) {
        const it = (item ?? {}) as Record<string, unknown>;
        if (it.type === "text" && typeof it.text === "string") {
          parts.push({ type: "text", content: it.text });
        } else {
          parts.push({ type: "text", content: it });
        }
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const call of msg.tool_calls) {
        const c = (call ?? {}) as Record<string, unknown>;
        const fn = (c.function ?? {}) as Record<string, unknown>;
        parts.push({
          type: "tool_call",
          id: typeof c.id === "string" ? c.id : undefined,
          name: typeof fn.name === "string" ? fn.name : undefined,
          arguments: fn.arguments,
        });
      }
    }
    if (msg.role === "tool") {
      return {
        role: "tool",
        parts: [
          {
            type: "tool_call_response",
            id:
              typeof msg.tool_call_id === "string"
                ? msg.tool_call_id
                : undefined,
            result: msg.content,
          },
        ],
      } satisfies GenAIMessage;
    }
    return {
      role: typeof msg.role === "string" ? msg.role : "user",
      parts,
    } satisfies GenAIMessage;
  });
}

export function normalizeOpenAIChatChoices(choices: unknown): GenAIMessage[] {
  if (!Array.isArray(choices)) return [];
  return choices.map((choice) => {
    const c = (choice ?? {}) as Record<string, unknown>;
    const message = (c.message ?? {}) as Record<string, unknown>;
    const [normalized] = normalizeOpenAIChatMessages([
      { role: message.role ?? "assistant", ...message },
    ]);
    return {
      role: normalized?.role ?? "assistant",
      parts: normalized?.parts ?? [],
      ...(typeof c.finish_reason === "string"
        ? { finish_reason: c.finish_reason }
        : {}),
    } satisfies GenAIMessage;
  });
}

// ---------------------------------------------------------------------------
// OpenAI Responses API
// ---------------------------------------------------------------------------

export function normalizeOpenAIResponsesInput(input: unknown): GenAIMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", parts: [{ type: "text", content: input }] }];
  }
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    const it = (item ?? {}) as Record<string, unknown>;
    const parts: GenAIMessagePart[] = [];
    const content = it.content;
    if (typeof content === "string") {
      parts.push({ type: "text", content });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const p = (part ?? {}) as Record<string, unknown>;
        if (typeof p.text === "string") {
          parts.push({ type: "text", content: p.text });
        } else {
          parts.push({ type: "text", content: p });
        }
      }
    }
    return {
      role: typeof it.role === "string" ? it.role : "user",
      parts,
    } satisfies GenAIMessage;
  });
}

export function normalizeOpenAIResponsesOutput(output: unknown): GenAIMessage[] {
  if (!Array.isArray(output)) return [];
  const messages: GenAIMessage[] = [];
  for (const item of output) {
    const it = (item ?? {}) as Record<string, unknown>;
    if (it.type === "message") {
      const parts: GenAIMessagePart[] = [];
      if (Array.isArray(it.content)) {
        for (const part of it.content) {
          const p = (part ?? {}) as Record<string, unknown>;
          if (typeof p.text === "string") {
            parts.push({ type: "text", content: p.text });
          } else {
            parts.push({ type: "text", content: p });
          }
        }
      }
      messages.push({
        role: typeof it.role === "string" ? it.role : "assistant",
        parts,
      });
    } else if (it.type === "function_call") {
      messages.push({
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: typeof it.call_id === "string" ? it.call_id : undefined,
            name: typeof it.name === "string" ? it.name : undefined,
            arguments: it.arguments,
          },
        ],
      });
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------

export function normalizeAnthropicMessages(messages: unknown): GenAIMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    const msg = (m ?? {}) as Record<string, unknown>;
    return {
      role: typeof msg.role === "string" ? msg.role : "user",
      parts: normalizeAnthropicContent(msg.content),
    } satisfies GenAIMessage;
  });
}

export function normalizeAnthropicContent(content: unknown): GenAIMessagePart[] {
  if (typeof content === "string") {
    return [{ type: "text", content }];
  }
  if (!Array.isArray(content)) return [];
  const parts: GenAIMessagePart[] = [];
  for (const block of content) {
    const b = (block ?? {}) as Record<string, unknown>;
    switch (b.type) {
      case "text":
        parts.push({ type: "text", content: b.text });
        break;
      case "tool_use":
        parts.push({
          type: "tool_call",
          id: typeof b.id === "string" ? b.id : undefined,
          name: typeof b.name === "string" ? b.name : undefined,
          arguments: b.input,
        });
        break;
      case "tool_result":
        parts.push({
          type: "tool_call_response",
          id: typeof b.tool_use_id === "string" ? b.tool_use_id : undefined,
          result: b.content,
        });
        break;
      default:
        parts.push({ type: "text", content: b });
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Vercel AI SDK (LanguageModel V1/V2 prompt shape)
// ---------------------------------------------------------------------------

export function normalizeAISDKPrompt(prompt: unknown): GenAIMessage[] {
  if (typeof prompt === "string") {
    return [{ role: "user", parts: [{ type: "text", content: prompt }] }];
  }
  if (!Array.isArray(prompt)) return [];
  return prompt.map((m) => {
    const msg = (m ?? {}) as Record<string, unknown>;
    const parts: GenAIMessagePart[] = [];
    const content = msg.content;
    if (typeof content === "string") {
      parts.push({ type: "text", content });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const p = (part ?? {}) as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") {
          parts.push({ type: "text", content: p.text });
        } else if (p.type === "tool-call") {
          parts.push({
            type: "tool_call",
            id: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
            name: typeof p.toolName === "string" ? p.toolName : undefined,
            arguments: p.args ?? p.input,
          });
        } else if (p.type === "tool-result") {
          parts.push({
            type: "tool_call_response",
            id: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
            result: p.result ?? p.output,
          });
        } else {
          parts.push({ type: "text", content: p });
        }
      }
    }
    return {
      role: typeof msg.role === "string" ? msg.role : "user",
      parts,
    } satisfies GenAIMessage;
  });
}

export function normalizeAISDKOutput(
  result: Record<string, unknown>,
  finishReason: string | undefined,
): GenAIMessage[] {
  const parts: GenAIMessagePart[] = [];
  // V2: result.content is an array of typed parts.
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      const p = (part ?? {}) as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") {
        parts.push({ type: "text", content: p.text });
      } else if (p.type === "tool-call") {
        parts.push({
          type: "tool_call",
          id: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
          name: typeof p.toolName === "string" ? p.toolName : undefined,
          arguments: p.args ?? p.input,
        });
      } else {
        parts.push({ type: "text", content: p });
      }
    }
  } else if (typeof result.text === "string") {
    // V1: plain text plus optional toolCalls array.
    parts.push({ type: "text", content: result.text });
    if (Array.isArray(result.toolCalls)) {
      for (const call of result.toolCalls) {
        const c = (call ?? {}) as Record<string, unknown>;
        parts.push({
          type: "tool_call",
          id: typeof c.toolCallId === "string" ? c.toolCallId : undefined,
          name: typeof c.toolName === "string" ? c.toolName : undefined,
          arguments: c.args,
        });
      }
    }
  }
  if (parts.length === 0) return [];
  return [
    {
      role: "assistant",
      parts,
      ...(finishReason ? { finish_reason: finishReason } : {}),
    },
  ];
}
