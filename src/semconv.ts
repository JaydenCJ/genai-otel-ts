/**
 * OpenTelemetry GenAI semantic-convention attribute names.
 *
 * These mirror the (still incubating) GenAI semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * They are declared locally (rather than imported from
 * `@opentelemetry/semantic-conventions/incubating`) so that the library has a
 * single, tiny runtime dependency surface (`@opentelemetry/api` only) and is
 * insulated from churn in the incubating package.
 */

// ---------------------------------------------------------------------------
// GenAI span attributes
// ---------------------------------------------------------------------------

export const ATTR_GEN_AI_OPERATION_NAME = "gen_ai.operation.name";
/** Current convention (semconv >= 1.36) for identifying the model provider. */
export const ATTR_GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";
/**
 * Deprecated alias of `gen_ai.provider.name` (semconv < 1.36). Emitted by
 * default for compatibility with backends that still key on it; disable via
 * `emitLegacyAttributes: false`.
 */
export const ATTR_GEN_AI_SYSTEM = "gen_ai.system";

export const ATTR_GEN_AI_REQUEST_MODEL = "gen_ai.request.model";
export const ATTR_GEN_AI_REQUEST_TEMPERATURE = "gen_ai.request.temperature";
export const ATTR_GEN_AI_REQUEST_TOP_P = "gen_ai.request.top_p";
export const ATTR_GEN_AI_REQUEST_TOP_K = "gen_ai.request.top_k";
export const ATTR_GEN_AI_REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens";
export const ATTR_GEN_AI_REQUEST_FREQUENCY_PENALTY =
  "gen_ai.request.frequency_penalty";
export const ATTR_GEN_AI_REQUEST_PRESENCE_PENALTY =
  "gen_ai.request.presence_penalty";
export const ATTR_GEN_AI_REQUEST_STOP_SEQUENCES =
  "gen_ai.request.stop_sequences";
export const ATTR_GEN_AI_REQUEST_SEED = "gen_ai.request.seed";
export const ATTR_GEN_AI_REQUEST_CHOICE_COUNT = "gen_ai.request.choice.count";
export const ATTR_GEN_AI_REQUEST_ENCODING_FORMATS =
  "gen_ai.request.encoding_formats";

export const ATTR_GEN_AI_RESPONSE_ID = "gen_ai.response.id";
export const ATTR_GEN_AI_RESPONSE_MODEL = "gen_ai.response.model";
export const ATTR_GEN_AI_RESPONSE_FINISH_REASONS =
  "gen_ai.response.finish_reasons";

export const ATTR_GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens";
export const ATTR_GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens";

/** Opt-in content capture (semconv >= 1.37 message attributes). */
export const ATTR_GEN_AI_INPUT_MESSAGES = "gen_ai.input.messages";
export const ATTR_GEN_AI_OUTPUT_MESSAGES = "gen_ai.output.messages";
export const ATTR_GEN_AI_SYSTEM_INSTRUCTIONS = "gen_ai.system_instructions";

export const ATTR_GEN_AI_TOOL_NAME = "gen_ai.tool.name";
export const ATTR_GEN_AI_TOOL_TYPE = "gen_ai.tool.type";
export const ATTR_GEN_AI_TOOL_CALL_ID = "gen_ai.tool.call.id";
/** Opt-in (content capture). */
export const ATTR_GEN_AI_TOOL_CALL_ARGUMENTS = "gen_ai.tool.call.arguments";
/** Opt-in (content capture). */
export const ATTR_GEN_AI_TOOL_CALL_RESULT = "gen_ai.tool.call.result";

// ---------------------------------------------------------------------------
// General attributes shared with the wider semconv registry
// ---------------------------------------------------------------------------

export const ATTR_ERROR_TYPE = "error.type";
export const ATTR_SERVER_ADDRESS = "server.address";
export const ATTR_SERVER_PORT = "server.port";

// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) attributes — experimental semconv registry
// ---------------------------------------------------------------------------

export const ATTR_MCP_METHOD_NAME = "mcp.method.name";
export const ATTR_MCP_TOOL_NAME = "mcp.tool.name";
export const ATTR_MCP_RESOURCE_URI = "mcp.resource.uri";
export const ATTR_MCP_PROMPT_NAME = "mcp.prompt.name";

// ---------------------------------------------------------------------------
// GenAI metric names
// ---------------------------------------------------------------------------

export const METRIC_GEN_AI_CLIENT_TOKEN_USAGE = "gen_ai.client.token.usage";
export const METRIC_GEN_AI_CLIENT_OPERATION_DURATION =
  "gen_ai.client.operation.duration";

export const ATTR_GEN_AI_TOKEN_TYPE = "gen_ai.token.type";

// ---------------------------------------------------------------------------
// Well-known values
// ---------------------------------------------------------------------------

/** Well-known `gen_ai.operation.name` values. */
export const GenAIOperationValues = {
  CHAT: "chat",
  GENERATE_CONTENT: "generate_content",
  TEXT_COMPLETION: "text_completion",
  EMBEDDINGS: "embeddings",
  EXECUTE_TOOL: "execute_tool",
  INVOKE_AGENT: "invoke_agent",
  CREATE_AGENT: "create_agent",
} as const;

/** Well-known `gen_ai.provider.name` values. */
export const GenAIProviderValues = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  AWS_BEDROCK: "aws.bedrock",
  AZURE_AI_OPENAI: "azure.ai.openai",
  GCP_GEMINI: "gcp.gemini",
  GCP_VERTEX_AI: "gcp.vertex_ai",
  GROQ: "groq",
  MISTRAL_AI: "mistral_ai",
  COHERE: "cohere",
  DEEPSEEK: "deepseek",
  PERPLEXITY: "perplexity",
  XAI: "x_ai",
} as const;

export const GenAITokenTypeValues = {
  INPUT: "input",
  OUTPUT: "output",
} as const;
