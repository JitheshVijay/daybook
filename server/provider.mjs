// Provider resolution and the OpenAI-compatible chat-completions shape used for
// every request. Credentials never leave this server.
const trimSlash = (url) => url.replace(/\/+$/, "");
export function resolveProvider(env = {}) {
  if (env.OPENROUTER_API_KEY)
    return {
      name: "openrouter",
      label: "OpenRouter",
      key: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || "",
      baseUrl: trimSlash(
        env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      ),
    };
  if (env.OPENAI_API_KEY) {
    const baseUrl = trimSlash(
      env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    );
    const direct = /^https:\/\/api\.openai\.com(\/|$)/.test(baseUrl);
    return {
      name: direct ? "openai" : "compatible",
      label: direct ? "OpenAI" : "OpenAI-compatible server",
      key: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || "",
      baseUrl,
    };
  }
  return null;
}
// Strict function schemas and parallel_tool_calls are OpenAI features; other models get
// plain function tools and rely on the app's own argument validation.
export const supportsStrictTools = (provider) =>
  provider.name === "openai" || /^openai\//.test(provider.model || "");

export function chatRequest(
  provider,
  {
    origin,
    instructions,
    input,
    maxTokens,
    schema,
    schemaName,
    tools,
    toolChoice = "auto",
  },
) {
  const body = {
    model: provider.model,
    messages: [{ role: "system", content: instructions }, ...input],
    // OpenAI's own endpoint prefers max_completion_tokens; everyone else takes max_tokens.
    [provider.name === "openai" ? "max_completion_tokens" : "max_tokens"]:
      maxTokens,
  };
  if (provider.name === "openai") body.store = false;
  if (schema)
    body.response_format = {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    };
  if (tools?.length) {
    const strict = supportsStrictTools(provider);
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(strict ? { strict: true } : {}),
      },
    }));
    body.tool_choice = toolChoice;
    // OpenRouter does not list parallel_tool_calls for these endpoints, and
    // require_parameters would then reject every route; the client loop handles
    // several calls in one reply either way.
    if (strict && provider.name === "openai") body.parallel_tool_calls = false;
  }
  if (provider.name === "openrouter")
    body.provider = { require_parameters: true };
  const headers = {
    Authorization: `Bearer ${provider.key}`,
    "Content-Type": "application/json",
  };
  if (provider.name === "openrouter") {
    headers["HTTP-Referer"] = origin || "http://localhost:5173";
    headers["X-OpenRouter-Title"] = "Daybook";
    headers["X-Title"] = "Daybook";
  }
  return { url: `${provider.baseUrl}/chat/completions`, headers, body };
}
export const describeError = (error) =>
  (typeof error === "string" ? error : error?.message || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
export function chatResult(result) {
  const choice = result?.choices?.[0];
  const error = result?.error || choice?.error;
  if (error) return { error: describeError(error) || "unknown error" };
  if (!choice) return { error: "empty response" };
  const message = choice.message || {};
  const text = Array.isArray(message.content)
    ? message.content
        .filter((part) => typeof part?.text === "string")
        .map((part) => part.text)
        .join("")
    : typeof message.content === "string"
      ? message.content
      : "";
  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter((call) => call?.function?.name)
    .map((call, index) => ({
      id:
        typeof call.id === "string" && call.id
          ? call.id.slice(0, 100)
          : `call_${index}`,
      type: "function",
      function: {
        name: String(call.function.name),
        arguments:
          typeof call.function.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function.arguments ?? {}),
      },
    }));
  return {
    text,
    refusal: typeof message.refusal === "string" ? message.refusal : "",
    truncated: choice.finish_reason === "length",
    finish: choice.finish_reason || null,
    toolCalls,
  };
}
// Best-effort provider error message for a non-2xx response; never the raw body.
export async function responseDetail(response) {
  try {
    if (typeof response.json === "function") {
      const data = await response.json();
      return describeError(data?.error || data?.message || "");
    }
    if (typeof response.text === "function")
      return describeError(JSON.parse(await response.text())?.error || "");
  } catch {
    /* Detail is optional. */
  }
  return "";
}
