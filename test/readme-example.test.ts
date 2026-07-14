// Guards the README "minimal example": the exact code block shown in all
// three READMEs must run and must produce the documented span.
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attr, setupOtel, type OtelHarness } from "./helpers.js";

let otel: OtelHarness;

beforeEach(() => {
  otel = setupOtel();
});

afterEach(async () => {
  await otel.teardown();
});

const exampleUrl = new URL("./readme-example/example.ts", import.meta.url);

describe("README minimal example", () => {
  it("runs verbatim and emits the documented span", async () => {
    // `genai-otel-ts` and `openai` are aliased in vitest.config.ts, so this
    // executes the exact source shown in the README.
    await import("./readme-example/example.js");

    const span = otel.span();
    expect(span.name).toBe("chat gpt-4o-mini");
    expect(attr(span, "gen_ai.operation.name")).toBe("chat");
    expect(attr(span, "gen_ai.provider.name")).toBe("openai");
    expect(attr(span, "gen_ai.request.model")).toBe("gpt-4o-mini");
    expect(attr(span, "gen_ai.usage.input_tokens")).toBe(12);
    expect(attr(span, "gen_ai.usage.output_tokens")).toBe(5);
  });

  it("appears verbatim in all three READMEs", async () => {
    const example = (await readFile(exampleUrl, "utf8")).trimEnd();
    expect(example.split("\n").length).toBeLessThanOrEqual(10);
    for (const name of ["README.md", "README.zh.md", "README.ja.md"]) {
      const readme = await readFile(
        new URL(`../${name}`, import.meta.url),
        "utf8",
      );
      expect(readme, `${name} must contain the minimal example`).toContain(
        example,
      );
    }
  });
});
