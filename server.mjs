import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const INDEX_PATH = path.join(__dirname, "index.html");

function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (_) {}
}

loadDotEnv();

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    try {
      const html = fs.readFileSync(INDEX_PATH, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Could not read index.html");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/completions") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      sendJson(res, 503, {
        error: {
          message:
            "Server missing OPENAI_API_KEY. Set it in your environment or a .env file next to server.mjs.",
        },
      });
      return;
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch {
      sendJson(res, 413, {
        error: { message: "Request body too large." },
      });
      return;
    }

    let upstreamRes;
    try {
      upstreamRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey.trim(),
        },
        body: raw,
      });
    } catch (e) {
      sendJson(res, 502, {
        error: { message: e.message || "Upstream request failed." },
      });
      return;
    }

    const text = await upstreamRes.text();
    res.writeHead(upstreamRes.status, {
      "Content-Type":
        upstreamRes.headers.get("content-type") ||
        "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(text);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log("PDF Chat at http://localhost:" + PORT);
  console.log("Set OPENAI_API_KEY in .env or your environment.");
});
