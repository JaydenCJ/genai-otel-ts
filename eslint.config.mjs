// ESLint flat config: typescript-eslint recommended rules over library
// source, tests, and repo scripts. Kept type-agnostic (no type-checked
// rule set) so `npm run lint` stays fast and needs no build step.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "examples/", "coverage/"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The instrumentation core is structural (duck typing) by design;
      // `any` at the SDK boundary is deliberate and documented.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      // Tests intentionally exercise unused results and empty handlers.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // This file must stay byte-identical to the README Quickstart snippet
    // (test/readme-example.test.ts asserts it), so it cannot carry inline
    // eslint directives; its unused `completion` is part of the docs.
    files: ["test/readme-example/example.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
