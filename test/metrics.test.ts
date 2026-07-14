import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DataPoint, HistogramMetricData } from "@opentelemetry/sdk-metrics";
import { instrumentOpenAI } from "../src/index.js";
import { setupOtel, type OtelHarness } from "./helpers.js";
import { fakeOpenAI } from "./fakes.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
});

afterEach(async () => {
  await otel.teardown();
});

async function findMetric(name: string) {
  const resourceMetrics = await otel.collectMetrics();
  for (const rm of resourceMetrics) {
    for (const scope of rm.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name === name) return metric as HistogramMetricData;
      }
    }
  }
  return undefined;
}

describe("GenAI client metrics", () => {
  it("records gen_ai.client.token.usage histograms for input and output", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });

    const metric = await findMetric("gen_ai.client.token.usage");
    expect(metric).toBeDefined();
    expect(metric!.descriptor.unit).toBe("{token}");

    const points = metric!.dataPoints as DataPoint<{ sum?: number }>[];
    const input = points.find(
      (p) => p.attributes["gen_ai.token.type"] === "input",
    );
    const output = points.find(
      (p) => p.attributes["gen_ai.token.type"] === "output",
    );
    expect(input?.value.sum).toBe(12);
    expect(output?.value.sum).toBe(5);
    expect(input?.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(input?.attributes["gen_ai.provider.name"]).toBe("openai");
    expect(input?.attributes["gen_ai.request.model"]).toBe("gpt-4o-mini");
    expect(input?.attributes["gen_ai.response.model"]).toBe(
      "gpt-4o-mini-2024-07-18",
    );
  });

  it("records gen_ai.client.operation.duration in seconds", async () => {
    const client = instrumentOpenAI(fakeOpenAI());
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });

    const metric = await findMetric("gen_ai.client.operation.duration");
    expect(metric).toBeDefined();
    expect(metric!.descriptor.unit).toBe("s");
    const points = metric!.dataPoints as DataPoint<{ count?: number; sum?: number }>[];
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]!.value.count).toBe(1);
    expect(points[0]!.value.sum).toBeGreaterThanOrEqual(0);
    expect(points[0]!.value.sum).toBeLessThan(60);
  });

  it("tags failed operations with error.type", async () => {
    const boom = Object.assign(new Error("rate limited"), { status: 429 });
    const client = instrumentOpenAI(fakeOpenAI({ chatError: boom }));
    await expect(
      client.chat.completions.create({ model: "gpt-4o-mini", messages: [] }),
    ).rejects.toThrow();

    const metric = await findMetric("gen_ai.client.operation.duration");
    const points = metric!.dataPoints;
    expect(points[0]!.attributes["error.type"]).toBe("429");
  });

  it("can be disabled via recordMetrics: false", async () => {
    const client = instrumentOpenAI(fakeOpenAI(), { recordMetrics: false });
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });

    const metric = await findMetric("gen_ai.client.token.usage");
    expect(metric).toBeUndefined();
  });
});
