import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Let the README minimal example run verbatim inside the test suite.
      "genai-otel-ts": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      openai: fileURLToPath(
        new URL("./test/readme-example/fake-openai-module.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
