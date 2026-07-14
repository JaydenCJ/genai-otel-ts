import { context, metrics, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { resetMetricsForTesting } from "../src/metrics.js";

export interface OtelHarness {
  /** Finished spans, in end order. */
  spans(): ReadableSpan[];
  /** Single span helper: asserts exactly one span was exported. */
  span(): ReadableSpan;
  /** Force-flush metrics and return the exported metric data. */
  collectMetrics(): Promise<
    ReturnType<InMemoryMetricExporter["getMetrics"]>
  >;
  teardown(): Promise<void>;
}

/**
 * Installs fresh global tracer/meter providers backed by in-memory exporters.
 * Call once per test (e.g. in beforeEach) and `teardown` in afterEach.
 */
export function setupOtel(): OtelHarness {
  trace.disable();
  metrics.disable();
  context.disable();
  resetMetricsForTesting();

  const contextManager = new AsyncHooksContextManager().enable();
  context.setGlobalContextManager(contextManager);

  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60 * 60 * 1000,
  });
  const meterProvider = new MeterProvider({ readers: [metricReader] });
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    spans: () => spanExporter.getFinishedSpans(),
    span: () => {
      const all = spanExporter.getFinishedSpans();
      if (all.length !== 1) {
        throw new Error(
          `expected exactly 1 span, got ${all.length}: ${all
            .map((s) => s.name)
            .join(", ")}`,
        );
      }
      return all[0]!;
    },
    collectMetrics: async () => {
      await metricReader.forceFlush();
      return metricExporter.getMetrics();
    },
    teardown: async () => {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      contextManager.disable();
      trace.disable();
      metrics.disable();
      context.disable();
      resetMetricsForTesting();
    },
  };
}

/** Build an async-iterable stream object from a chunk array. */
export function asyncStream<T>(chunks: T[], failWith?: Error) {
  return {
    consumed: false,
    async *[Symbol.asyncIterator]() {
      this.consumed = true;
      for (const chunk of chunks) {
        yield chunk;
      }
      if (failWith) throw failWith;
    },
    tee(): never {
      throw new Error("tee is unsupported by this test fake");
    },
  };
}

/** Build a WHATWG ReadableStream from a chunk array. */
export function readableStream<T>(chunks: T[], failWith?: Error) {
  let i = 0;
  return new ReadableStream<T>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]!);
      } else if (failWith) {
        controller.error(failWith);
      } else {
        controller.close();
      }
    },
  });
}

export async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

export async function drainReadable(
  stream: ReadableStream<unknown>,
): Promise<unknown[]> {
  const out: unknown[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

export function attr(span: ReadableSpan, key: string): unknown {
  return span.attributes[key];
}
