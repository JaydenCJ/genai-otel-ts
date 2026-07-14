import { SpanStatusCode, type Attributes } from "@opentelemetry/api";
import { startGenAISpan, safeJson } from "./genai-span.js";
import {
  ATTR_ERROR_TYPE,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_TOOL_TYPE,
  ATTR_MCP_METHOD_NAME,
  ATTR_MCP_PROMPT_NAME,
  ATTR_MCP_RESOURCE_URI,
  ATTR_MCP_TOOL_NAME,
  GenAIOperationValues,
} from "./semconv.js";
import {
  asString,
  isInstrumented,
  markInstrumented,
  patchMethod,
  promised,
} from "./internal/util.js";
import {
  resolveConfig,
  type GenAIInstrumentationOptions,
  type ResolvedConfig,
} from "./types.js";

/**
 * Instrument an MCP client (`@modelcontextprotocol/sdk` `Client`) in place.
 *
 * Patches, when present:
 *  - `client.callTool`      → `execute_tool {tool}` spans (GenAI semconv)
 *  - `client.readResource`  → `resources/read {uri}` spans
 *  - `client.getPrompt`     → `prompts/get {name}` spans
 *  - `client.listTools` / `listResources` / `listPrompts` → list spans
 *
 * Tool-call spans carry both the GenAI `execute_tool` attributes and the
 * experimental MCP registry attributes (`mcp.method.name`, ...), so they
 * light up in any backend that understands either convention.
 *
 * @returns the same client, for one-line usage:
 * ```ts
 * const client = instrumentMCPClient(new Client({ name: "app", version: "1" }));
 * ```
 */
export function instrumentMCPClient<T>(
  client: T,
  options: GenAIInstrumentationOptions = {},
): T {
  if (client == null || typeof client !== "object") {
    throw new TypeError("instrumentMCPClient: expected an MCP client instance");
  }
  if (isInstrumented(client)) return client;
  const config = resolveConfig(options);

  patchCallTool(client, config);
  patchSimpleMethod(client, config, "readResource", "resources/read", (params) => {
    const uri = asString(params.uri);
    return {
      name: uri ? `resources/read ${uri}` : "resources/read",
      attributes: uri ? { [ATTR_MCP_RESOURCE_URI]: uri } : {},
    };
  });
  patchSimpleMethod(client, config, "getPrompt", "prompts/get", (params) => {
    const name = asString(params.name);
    return {
      name: name ? `prompts/get ${name}` : "prompts/get",
      attributes: name ? { [ATTR_MCP_PROMPT_NAME]: name } : {},
    };
  });
  for (const [method, rpc] of [
    ["listTools", "tools/list"],
    ["listResources", "resources/list"],
    ["listPrompts", "prompts/list"],
  ] as const) {
    patchSimpleMethod(client, config, method, rpc, () => ({
      name: rpc,
      attributes: {},
    }));
  }

  markInstrumented(client);
  return client;
}

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

function patchCallTool(client: unknown, config: ResolvedConfig): void {
  patchMethod(client, "callTool", (original) => {
    return function instrumentedCallTool(...args: unknown[]) {
      const params = (args[0] ?? {}) as Record<string, unknown>;
      const toolName = asString(params.name);

      const attributes: Attributes = {
        [ATTR_MCP_METHOD_NAME]: "tools/call",
        [ATTR_GEN_AI_TOOL_TYPE]: "function",
      };
      if (toolName) {
        attributes[ATTR_GEN_AI_TOOL_NAME] = toolName;
        attributes[ATTR_MCP_TOOL_NAME] = toolName;
      }
      if (config.captureMessageContent && params.arguments !== undefined) {
        attributes[ATTR_GEN_AI_TOOL_CALL_ARGUMENTS] = safeJson(
          params.arguments,
        );
      }

      const handle = startGenAISpan({
        operation: GenAIOperationValues.EXECUTE_TOOL,
        spanName: toolName
          ? `${GenAIOperationValues.EXECUTE_TOOL} ${toolName}`
          : GenAIOperationValues.EXECUTE_TOOL,
        attributes,
        config,
      });

      return promised(handle, original, args, (result) => {
        const r = (result ?? {}) as Record<string, unknown>;
        if (config.captureMessageContent && r.content !== undefined) {
          handle.span.setAttribute(
            ATTR_GEN_AI_TOOL_CALL_RESULT,
            safeJson(r.content),
          );
        }
        if (r.isError === true) {
          // MCP surfaces tool failures in-band; reflect them on the span.
          handle.span.setAttribute(ATTR_ERROR_TYPE, "tool_error");
          handle.span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "MCP tool returned isError=true",
          });
        }
        handle.end();
        return result;
      });
    };
  });
}

// ---------------------------------------------------------------------------
// generic request patch
// ---------------------------------------------------------------------------

function patchSimpleMethod(
  client: unknown,
  config: ResolvedConfig,
  method: string,
  rpcName: string,
  describe: (params: Record<string, unknown>) => {
    name: string;
    attributes: Attributes;
  },
): void {
  patchMethod(client, method, (original) => {
    return function instrumentedMethod(...args: unknown[]) {
      const params = (args[0] ?? {}) as Record<string, unknown>;
      const { name, attributes } = describe(params);
      const handle = startGenAISpan({
        operation: rpcName,
        spanName: name,
        attributes: { ...attributes, [ATTR_MCP_METHOD_NAME]: rpcName },
        config,
      });
      return promised(handle, original, args, (result) => {
        handle.end();
        return result;
      });
    };
  });
}
