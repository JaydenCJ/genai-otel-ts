// Marks dist/cjs as CommonJS so the dual ESM/CJS build resolves correctly
// under a root package.json with "type": "module".
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/cjs", { recursive: true });
writeFileSync(
  "dist/cjs/package.json",
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n"
);
console.log("dist prepared: dist/cjs/package.json written");
