// Local server only: credentials are never bundled into the browser app.
import { resolveProvider, responseDetail } from "./provider.mjs";
import { buildChatRequest, chatReply } from "./chat.mjs";
import { nutritionRequest, nutritionResult } from "./nutrition.mjs";
import { songInfoRequest, songInfoResult } from "./songs.mjs";

const RATE_LIMIT_PER_MINUTE = 40;
const MAX_BODY_BYTES = 400_000;
const PROVIDER_TIMEOUT_MS = 90_000;

export function assistantMiddleware(env = {}, fetchImpl = fetch) {
  const provider = resolveProvider(env);
  const configured = Boolean(provider?.model);
  const recent = new Map();
  return async function (req, res, next) {
    const path = req.url?.split("?")[0];
    if (!path?.startsWith("/api/")) return next();
    const respond = (status, data) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(data));
    };
    if (path === "/api/assistant/status" && req.method === "GET")
      return respond(200, {
        configured,
        provider: configured ? provider.label : null,
        model: configured ? provider.model : null,
      });
    const nutrition = path === "/api/nutrition";
    const songs = path === "/api/songs";
    if (!["/api/chat", "/api/nutrition", "/api/songs"].includes(path) || req.method !== "POST")
      return respond(404, { error: "Not found." });
    if (!configured)
      return respond(503, {
        error: provider
          ? `${provider.label} key found but no model is set. Set ${provider.name === "openrouter" ? "OPENROUTER_MODEL" : "OPENAI_MODEL"} in .env.local on the server, then restart Daybook.`
          : "AI is not connected. Add OPENROUTER_API_KEY and OPENROUTER_MODEL (or OPENAI_API_KEY and OPENAI_MODEL) to .env.local on the server, then restart Daybook.",
      });
    try {
      const origin = new URL(req.headers.origin || "");
      if (origin.host !== req.headers.host)
        return respond(403, { error: "This request must come from Daybook." });
    } catch {
      return respond(403, { error: "This request must come from Daybook." });
    }
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return respond(415, { error: "Expected JSON." });
    const address = req.socket.remoteAddress || "local";
    const now = Date.now();
    const times = (recent.get(address) || []).filter((t) => now - t < 60000);
    if (times.length >= RATE_LIMIT_PER_MINUTE)
      return respond(429, {
        error: "Give the assistant a moment, then try again.",
      });
    recent.set(address, [...times, now]);
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > MAX_BODY_BYTES)
          return respond(413, {
            error: "This conversation is too long to send. Start a new chat.",
          });
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return respond(400, { error: "Invalid request." });
      }
      let request;
      try {
        request = nutrition
          ? nutritionRequest(payload, provider, req.headers.origin)
          : songs
            ? songInfoRequest(payload, provider, req.headers.origin)
            : buildChatRequest(payload, provider, req.headers.origin);
      } catch (error) {
        return respond(400, { error: error.message });
      }
      const response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        body: JSON.stringify(request.body),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          return respond(502, {
            error:
              "The AI key was not accepted. Check the server configuration.",
          });
        if (response.status === 402)
          return respond(502, {
            error: `The ${provider.label} account has no credits available. Add credits, then try again.`,
          });
        if (response.status === 429)
          return respond(502, {
            error:
              "The AI service is rate limited or has no available quota. Try later or check the account.",
          });
        const detail = await responseDetail(response);
        return respond(502, {
          error: `The AI service could not complete this request. Check the model configuration and try again.${detail ? ` (${provider.label}: ${detail})` : ""}`,
        });
      }
      const result = await response.json();
      try {
        return respond(200, nutrition ? nutritionResult(result, payload) : songs ? songInfoResult(result, payload) : chatReply(result));
      } catch (error) {
        return respond(502, { error: error.message });
      }
    } catch (err) {
      return respond(err.name === "TimeoutError" ? 504 : 502, {
        error:
          err.name === "TimeoutError"
            ? "The AI took too long. Please try again."
            : "Could not reach the AI service. Please try again.",
      });
    }
  };
}
export function assistantPlugin(env) {
  return {
    name: "daybook-assistant",
    configureServer(server) {
      server.middlewares.use(assistantMiddleware(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use(assistantMiddleware(env));
    },
  };
}
