/**
 * MCP (Model Context Protocol) client example.
 *
 * Prerequisites:
 *   npm install @modelcontextprotocol/sdk @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { instrument } from "genai-otel-ts";

const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
sdk.start();

const client = instrument(
  new Client({ name: "example-client", version: "1.0.0" }),
);

await client.connect(
  new StdioClientTransport({ command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] }),
);

// `tools/list` span
const { tools } = await client.listTools();
console.log(tools.map((t) => t.name));

// `execute_tool echo` span with gen_ai.tool.name + mcp.method.name.
// Tool calls that return isError=true are marked as span errors.
const result = await client.callTool({
  name: "echo",
  arguments: { message: "hello traces" },
});
console.log(result);

await client.close();
await sdk.shutdown();
