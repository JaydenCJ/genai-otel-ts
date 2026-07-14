// Duck-typed stand-in for the `openai` package, wired up via a vitest/tsconfig
// alias so the README minimal example can run verbatim in the test suite
// without depending on the real SDK.
import { fakeOpenAI } from "../fakes.js";

type FakeClient = ReturnType<typeof fakeOpenAI>;

const OpenAI = function OpenAI() {
  return fakeOpenAI();
} as unknown as new () => FakeClient;

export default OpenAI;
