import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import {
  activeProspectSlug,
  loadDemoScenario,
  loadProspect,
} from "../config.ts";
import { AutomationService } from "../service/automation.ts";
import { Store } from "../store/database.ts";

const MAX_BODY = 64 * 1024;
const PORT = Number(process.env.PORT || 18787);
const HOST = process.env.HOST || "127.0.0.1";
const SECRET = process.env.INTERNAL_SECRET;
const N8N_BASE = process.env.N8N_BASE_URL || "http://127.0.0.1:5678";
if (!SECRET || SECRET.length < 16) {
  throw new Error(
    "INTERNAL_SECRET of at least 16 characters is required. Run scripts/setup.sh.",
  );
}

const store = new Store(process.env.DB_PATH || "data/demo.sqlite");
const service = new AutomationService(store);

function json(res: ServerResponse, status: number, data: unknown) {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      throw Object.assign(new Error("Request body exceeds 64 KiB."), {
        status: 413,
      });
    }
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  } catch {
    throw Object.assign(new Error("Malformed JSON body."), { status: 400 });
  }
}
async function proxy(req: IncomingMessage, res: ServerResponse, path: string) {
  const payload = await body(req);
  const upstream = await fetch(`${N8N_BASE}/webhook/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await upstream.text();
  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json",
  });
  res.end(text);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    if (req.method === "GET" && url.pathname === "/api/demo/health") {
      return json(res, 200, { ok: true, schemaVersion: 1 });
    }
    if (req.method === "GET" && url.pathname === "/api/demo/leads") {
      return json(res, 200, { leads: store.recent(activeProspectSlug()) });
    }
    if (req.method === "GET" && url.pathname === "/api/demo/status") {
      return json(res, 200, {
        counts: store.counts(activeProspectSlug()),
        leads: store.recent(activeProspectSlug()),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/demo/scenarios") {
      const config = loadProspect();
      return json(res, 200, {
        prospect: {
          slug: config.slug,
          displayName: config.displayName,
          disclaimer: config.disclaimer,
          followupTimingLabel: config.EXAMPLE_SIMULATED.timingLabel,
        },
        scenarios: config.demoScenarios.map(({ id, label }) => ({ id, label })),
      });
    }
    if (
      req.method === "GET" && url.pathname.startsWith("/api/demo/scenarios/")
    ) {
      return json(
        res,
        200,
        loadDemoScenario(url.pathname.slice("/api/demo/scenarios/".length)),
      );
    }
    if (req.method === "POST" && url.pathname === "/api/demo/intake") {
      return await proxy(req, res, "demo-inquiry");
    }
    if (req.method === "POST" && url.pathname === "/api/demo/followups/run") {
      return await proxy(req, res, "demo-followups-run");
    }
    if (req.method === "POST" && url.pathname === "/api/demo/customer-update") {
      return await proxy(req, res, "demo-customer-update");
    }
    if (req.method === "POST" && url.pathname === "/api/demo/reset") {
      const input = await body(req);
      if (input.confirm !== "RESET DEMO") {
        return json(res, 400, { error: "Confirmation must equal RESET DEMO." });
      }
      store.reset(activeProspectSlug());
      return json(res, 200, { reset: true });
    }
    if (url.pathname.startsWith("/internal/")) {
      if (req.headers["x-internal-secret"] !== SECRET) {
        return json(res, 401, { error: "Unauthorized internal route." });
      }
      const input = await body(req);
      if (req.method === "POST" && url.pathname === "/internal/intake") {
        try {
          return json(res, 200, service.intake(input.inquiry ?? input));
        } catch (error: any) {
          return json(res, error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 400, {
            error: error.message,
            code: error.code ?? "INVALID_INPUT",
            state: error.code === "IDEMPOTENCY_CONFLICT" ? "CONFLICT" : "ERROR",
          });
        }
      }
      if (req.method === "POST" && url.pathname === "/internal/followups/run") {
        return json(res, 200, service.runFollowups());
      }
      if (
        req.method === "POST" && url.pathname === "/internal/customer-update"
      ) {
        if (!Number.isInteger(input.leadId)) {
          return json(res, 400, { error: "Integer leadId required." });
        }
        return json(res, 200, service.update(input.leadId));
      }
      return json(res, 404, { error: "Internal command not found." });
    }
    if (req.method !== "GET") return json(res, 404, { error: "Not found." });
    const relative = url.pathname === "/"
      ? "index.html"
      : normalize(url.pathname).replace(/^[/\\]+/, "");
    if (relative.includes("..")) return json(res, 404, { error: "Not found." });
    const file = join(process.cwd(), "public", relative);
    if (!statSync(file).isFile()) {
      throw Object.assign(new Error("Not found."), { status: 404 });
    }
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css",
      ".js": "text/javascript",
    };
    const data = readFileSync(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
    });
    res.end(data);
  } catch (error: any) {
    json(res, error.status || 500, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
});
server.listen(
  PORT,
  HOST,
  () => console.log(`Demo service listening on http://${HOST}:${PORT}`),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }));
}
