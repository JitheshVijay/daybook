// /api/data: the app's records and conversation in the local SQLite database.
// Only this computer may use it (the dev server also listens on the network, and there is no
// login). Other devices get 403 and keep their data in their own browser, as before.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY_BYTES = 5_000_000;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function dataMiddleware({ file = process.env.DAYBOOK_DB || path.join(root, "data", "daybook.db"), open = openDatabase } = {}) {
  let store = null;
  let failure = null;
  const database = () => {
    if (!store && !failure) {
      try {
        store = open(file);
      } catch (error) {
        failure = error;
      }
    }
    return store;
  };
  return async function (req, res, next) {
    const url = req.url?.split("?")[0] || "";
    if (url !== "/api/data" && !url.startsWith("/api/data/")) return next();
    const respond = (status, body) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
    };
    if (!LOOPBACK.has(req.socket?.remoteAddress))
      return respond(403, { error: "The database is only available on the computer running Daybook.", mode: "browser" });
    const db = database();
    if (!db) return respond(503, { error: `The database could not be opened (${failure?.message || "unknown error"}).`, mode: "browser" });
    const write = req.method !== "GET";
    if (write) {
      try {
        if (new URL(req.headers.origin || "").host !== req.headers.host) return respond(403, { error: "This request must come from Daybook." });
      } catch {
        return respond(403, { error: "This request must come from Daybook." });
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) return respond(415, { error: "Expected JSON." });
    }
    let payload = null;
    if (write) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) return respond(413, { error: "That is too much data for one save." });
      }
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        return respond(400, { error: "Invalid request." });
      }
    }
    try {
      if (url === "/api/data" && req.method === "GET")
        return respond(200, { mode: "database", file: path.relative(root, file).startsWith("..") ? file : path.relative(root, file), version: db.version(), empty: db.isEmpty(), state: db.readState(), chat: db.readChat() });
      if (url === "/api/data/version" && req.method === "GET") return respond(200, { version: db.version() });
      if (url === "/api/data/changes" && req.method === "POST") return respond(200, { version: db.applyChanges(payload?.changes) });
      if (url === "/api/data" && req.method === "PUT") return respond(200, { version: db.replaceState(payload?.state) });
      if (url === "/api/data/chat" && req.method === "PUT") return respond(200, { version: db.writeChat(payload?.chat) });
      return respond(404, { error: "Not found." });
    } catch (error) {
      return respond(400, { error: `Not saved: ${error.message}` });
    }
  };
}

export function dataPlugin(options) {
  return {
    name: "daybook-data",
    configureServer(server) {
      server.middlewares.use(dataMiddleware(options));
    },
    configurePreviewServer(server) {
      server.middlewares.use(dataMiddleware(options));
    },
  };
}
