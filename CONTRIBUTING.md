# Contributing to genai-otel-ts

Thanks for your interest in contributing. This document explains how to get
set up and what we look for in changes.

## Development setup

Requirements: Node.js ≥ 18 (Node 22 recommended) and npm.

Get the source:

```bash
git clone https://github.com/JaydenCJ/genai-otel-ts.git
cd genai-otel-ts
npm install
npm test          # vitest, in-memory OTel exporters — no network, no API keys
npm run lint      # eslint (typescript-eslint recommended rules)
npm run typecheck # strict TypeScript over src/ and test/
npm run build     # dual ESM + CJS build into dist/
```

## Project layout

- `src/` — library source. Public entry points live at the top level;
  shared plumbing (method patching, stream wrapping, content normalizers)
  lives in `src/internal/`.
- `test/` — vitest suites. `test/fakes.ts` contains duck-typed stand-ins for
  the OpenAI / Anthropic / AI SDK / MCP clients; `test/helpers.ts` wires up
  in-memory span/metric exporters.
- `examples/` — runnable usage examples (not compiled as part of the build).

## Guidelines

### Design principles

1. **Standard output only.** Spans and metrics must follow the
   [OTel GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
   New attributes belong in `src/semconv.ts` with a link to the spec.
2. **No SDK dependencies.** Integrations are duck-typed. Do not add `openai`,
   `@anthropic-ai/sdk`, `ai`, or `@modelcontextprotocol/sdk` as dependencies —
   not even dev dependencies; tests use structural fakes.
3. **Never break user code.** Instrumentation must be transparent: results
   pass through unchanged, errors rethrow, and bookkeeping failures inside
   the instrumentation must not propagate to the caller.
4. **Content capture is opt-in.** Anything that can contain user data must be
   gated behind `captureMessageContent`.
5. **Spans end exactly once** — including streaming, early break, cancel,
   and error paths. Add a test for each new completion path.

### Pull requests

- Keep PRs focused; one logical change per PR.
- Add or update tests for any behavior change. `npm test` and
  `npm run typecheck` must pass.
- Update `CHANGELOG.md` under an `Unreleased` heading.
- If you touch public API or emitted telemetry, update `README.md` **and**
  its translations (`README.zh.md`, `README.ja.md`). If you can't translate,
  say so in the PR and we'll help.

### Commit messages

Conventional Commits are appreciated but not enforced
(`feat:`, `fix:`, `docs:`, `test:`, `chore:` ...).

### Reporting bugs

Please include: Node version, the SDK and its version (e.g. `openai@5.x`),
your OTel SDK setup, a minimal reproduction, and the span output you expected
vs. what you got (the console exporter from
`examples/05-console-exporter.ts` helps).

## Releasing (maintainers)

1. Update `CHANGELOG.md` and bump `version` in `package.json` and
   `src/version.ts`.
2. `npm run build && npm test`
3. `npm publish` (runs `prepublishOnly` checks) and tag the release.

## Code of conduct

Be kind and constructive. We follow the spirit of the
[Contributor Covenant](https://www.contributor-covenant.org/).
