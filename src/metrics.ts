import { metrics, type Attributes, type Histogram } from "@opentelemetry/api";
import {
  ATTR_GEN_AI_TOKEN_TYPE,
  GenAITokenTypeValues,
  METRIC_GEN_AI_CLIENT_OPERATION_DURATION,
  METRIC_GEN_AI_CLIENT_TOKEN_USAGE,
} from "./semconv.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

/**
 * Lazily-created GenAI client metric instruments, per the GenAI
 * semantic-convention metrics:
 * https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
 *
 * Instruments are resolved from the *global* MeterProvider on first use so
 * that callers who register their SDK after importing this library still get
 * real metrics.
 */

interface Instruments {
  tokenUsage: Histogram;
  operationDuration: Histogram;
}

let instruments: Instruments | undefined;

// Bucket boundaries recommended by the GenAI semconv metrics document.
const TOKEN_USAGE_BUCKETS = [
  1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
  16777216, 67108864,
];
const DURATION_BUCKETS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48,
  40.96, 81.92,
];

function getInstruments(): Instruments {
  if (!instruments) {
    const meter = metrics.getMeter(PKG_NAME, PKG_VERSION);
    instruments = {
      tokenUsage: meter.createHistogram(METRIC_GEN_AI_CLIENT_TOKEN_USAGE, {
        description: "Number of input and output tokens used by GenAI clients",
        unit: "{token}",
        advice: { explicitBucketBoundaries: TOKEN_USAGE_BUCKETS },
      }),
      operationDuration: meter.createHistogram(
        METRIC_GEN_AI_CLIENT_OPERATION_DURATION,
        {
          description: "Duration of GenAI client operations",
          unit: "s",
          advice: { explicitBucketBoundaries: DURATION_BUCKETS },
        },
      ),
    };
  }
  return instruments;
}

/**
 * Reset cached instruments (test hook — allows re-binding to a fresh global
 * MeterProvider between test cases).
 *
 * @internal
 */
export function resetMetricsForTesting(): void {
  instruments = undefined;
}

export function recordOperationDuration(
  durationSeconds: number,
  attributes: Attributes,
): void {
  getInstruments().operationDuration.record(durationSeconds, attributes);
}

export function recordTokenUsage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  attributes: Attributes,
): void {
  const { tokenUsage } = getInstruments();
  if (typeof inputTokens === "number") {
    tokenUsage.record(inputTokens, {
      ...attributes,
      [ATTR_GEN_AI_TOKEN_TYPE]: GenAITokenTypeValues.INPUT,
    });
  }
  if (typeof outputTokens === "number") {
    tokenUsage.record(outputTokens, {
      ...attributes,
      [ATTR_GEN_AI_TOKEN_TYPE]: GenAITokenTypeValues.OUTPUT,
    });
  }
}
