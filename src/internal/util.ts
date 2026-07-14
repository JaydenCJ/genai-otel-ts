import type { Attributes } from "@opentelemetry/api";
import { ATTR_SERVER_ADDRESS, ATTR_SERVER_PORT } from "../semconv.js";
import type { GenAISpanHandle } from "../genai-span.js";

const PATCHED = Symbol.for("genai-otel-ts.patched");
const INSTRUMENTED = Symbol.for("genai-otel-ts.instrumented");

/**
 * Replace `obj[method]` with `wrap(original)`, binding the original to `obj`.
 * Idempotent: a method is never wrapped twice, and an object marked
 * instrumented is skipped by `markInstrumented`/`isInstrumented` callers.
 */
export function patchMethod(
  obj: unknown,
  method: string,
  wrap: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
): boolean {
  if (obj == null || typeof obj !== "object") return false;
  const target = obj as Record<string | symbol, unknown>;
  const original = target[method];
  if (typeof original !== "function") return false;
  if ((original as unknown as Record<symbol, unknown>)[PATCHED]) return false;
  const bound = (original as (...args: unknown[]) => unknown).bind(target);
  const patched = wrap(bound);
  (patched as unknown as Record<symbol, unknown>)[PATCHED] = true;
  target[method] = patched;
  return true;
}

export function isInstrumented(obj: unknown): boolean {
  return (
    obj != null &&
    (typeof obj === "object" || typeof obj === "function") &&
    Boolean((obj as Record<symbol, unknown>)[INSTRUMENTED])
  );
}

export function markInstrumented(obj: unknown): void {
  if (obj == null || (typeof obj !== "object" && typeof obj !== "function")) {
    return;
  }
  try {
    Object.defineProperty(obj, INSTRUMENTED, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // Frozen objects: fall through; double instrumentation is still prevented
    // per-method by patchMethod.
  }
}

/** Derive `server.address` / `server.port` attributes from a base URL. */
export function serverAttributesFromUrl(baseURL: unknown): Attributes {
  if (typeof baseURL !== "string" || baseURL.length === 0) return {};
  try {
    const url = new URL(baseURL);
    const attrs: Attributes = { [ATTR_SERVER_ADDRESS]: url.hostname };
    if (url.port !== "") {
      attrs[ATTR_SERVER_PORT] = Number(url.port);
    } else if (url.protocol === "https:") {
      attrs[ATTR_SERVER_PORT] = 443;
    } else if (url.protocol === "http:") {
      attrs[ATTR_SERVER_PORT] = 80;
    }
    return attrs;
  } catch {
    return {};
  }
}

/** Numeric coercion helper for loosely-typed SDK payloads. */
export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as string[];
  }
  return undefined;
}

export interface StreamReducer<TChunk> {
  /** Called for every chunk that flows through the stream. */
  onChunk(chunk: TChunk): void;
  /** Called exactly once when the stream ends (including early break). */
  onEnd(): void;
  /** Called exactly once if the stream throws. */
  onError(error: unknown): void;
}

/**
 * Wrap an async-iterable stream so that the reducer observes every chunk and
 * the span is completed exactly once — on normal exhaustion, on early
 * `break`/`return`, or on error. All other properties/methods of the
 * underlying stream object keep working via a delegating Proxy.
 */
export function instrumentAsyncIterable<T extends object>(
  stream: T,
  reducer: StreamReducer<unknown>,
): T {
  const inner = stream as AsyncIterable<unknown>;
  let settled = false;
  const settleEnd = () => {
    if (!settled) {
      settled = true;
      reducer.onEnd();
    }
  };
  const settleError = (error: unknown) => {
    if (!settled) {
      settled = true;
      reducer.onError(error);
    }
  };

  async function* iterate(): AsyncGenerator<unknown> {
    try {
      for await (const chunk of inner) {
        reducer.onChunk(chunk);
        yield chunk;
      }
    } catch (error) {
      settleError(error);
      throw error;
    } finally {
      // Reached on normal completion AND on early consumer break/return.
      settleEnd();
    }
  }

  return new Proxy(stream, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return () => iterate();
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * Wrap a WHATWG ReadableStream so the reducer observes every chunk and the
 * span completes exactly once — on close, cancel, or error.
 */
export function instrumentReadableStream(
  stream: ReadableStream<unknown>,
  reducer: StreamReducer<unknown>,
): ReadableStream<unknown> {
  const reader = stream.getReader();
  let settled = false;
  const settleEnd = () => {
    if (!settled) {
      settled = true;
      reducer.onEnd();
    }
  };
  const settleError = (error: unknown) => {
    if (!settled) {
      settled = true;
      reducer.onError(error);
    }
  };

  return new ReadableStream<unknown>({
    async pull(controller) {
      let result: ReadableStreamReadResult<unknown>;
      try {
        result = await reader.read();
      } catch (error) {
        settleError(error);
        controller.error(error);
        return;
      }
      if (result.done) {
        settleEnd();
        controller.close();
        return;
      }
      reducer.onChunk(result.value);
      controller.enqueue(result.value);
    },
    async cancel(reason) {
      settleEnd();
      await reader.cancel(reason);
    },
  });
}

/** True for objects exposing the async-iterator protocol. */
export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as Record<symbol, unknown>)[Symbol.asyncIterator] ===
      "function"
  );
}

/** True for WHATWG ReadableStream-shaped objects. */
export function isReadableStream(value: unknown): value is ReadableStream<unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { getReader?: unknown }).getReader === "function"
  );
}

/**
 * Invoke `original` inside the span's context and route the settled promise
 * through `onResult` / `handle.fail`. Synchronous throws also fail the span.
 */
export function promised(
  handle: GenAISpanHandle,
  original: (...args: unknown[]) => unknown,
  args: unknown[],
  onResult: (result: unknown) => unknown,
): Promise<unknown> {
  let invoked: unknown;
  try {
    invoked = handle.runInContext(() => original(...args));
  } catch (error) {
    handle.fail(error);
    throw error;
  }
  return Promise.resolve(invoked).then(
    (result) => onResult(result),
    (error) => {
      handle.fail(error);
      throw error;
    },
  );
}

/** Set a numeric attribute only when the value is a finite number. */
export function setNumAttr(
  attrs: Attributes,
  key: string,
  value: unknown,
): void {
  const num = asNumber(value);
  if (num !== undefined) attrs[key] = num;
}

/** Build a StreamReducer that funnels accumulated state into a span handle. */
export function spanStreamReducer<TState>(
  handle: GenAISpanHandle,
  initial: TState,
  accumulate: (state: TState, chunk: unknown) => void,
  finalize: (state: TState) => Parameters<GenAISpanHandle["end"]>[0],
): StreamReducer<unknown> {
  const state = initial;
  return {
    onChunk(chunk) {
      try {
        accumulate(state, chunk);
      } catch {
        // Never let instrumentation bookkeeping break user streams.
      }
    },
    onEnd() {
      handle.end(finalize(state));
    },
    onError(error) {
      handle.fail(error);
    },
  };
}
