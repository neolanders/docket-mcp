import { randomUUID } from "node:crypto";
import axios, { isAxiosError, type AxiosInstance } from "axios";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

dotenv.config();

function createApi(): AxiosInstance {
  return axios.create({
    baseURL: process.env.DOCKET_BASE_URL,
    headers: {
      Authorization: `Bearer ${process.env.DOCKET_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

const api = createApi();

function toolErr(e: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const text = isAxiosError(e)
    ? typeof e.response?.data === "object"
      ? JSON.stringify(e.response?.data)
      : e.message
    : e instanceof Error
      ? e.message
      : String(e);
  return { content: [{ type: "text", text }], isError: true };
}

function getServer(): McpServer {
  const server = new McpServer(
    { name: "docket-mcp", version: "1.0.0" },
    {
      instructions:
        "Docket QA: use these tools to read/update tests and steps, run suites, and fetch run results. Server must have DOCKET_BASE_URL and DOCKET_API_KEY set.",
    }
  );

  server.registerTool(
    "get_test_case",
    { description: "Fetch a Docket test by id", inputSchema: { testId: z.string() } },
    async ({ testId }) => {
      try {
        const { data } = await api.get(`/api/tests/${testId}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return toolErr(e);
      }
    }
  );

  server.registerTool(
    "update_test_step",
    {
      description: "Patch a step on a Docket test",
      inputSchema: {
        testId: z.string(),
        stepId: z.string(),
        payload: z.record(z.string(), z.unknown()),
      },
    },
    async ({ testId, stepId, payload }) => {
      try {
        const { data } = await api.patch(`/api/tests/${testId}/steps/${stepId}`, payload);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return toolErr(e);
      }
    }
  );

  server.registerTool(
    "update_test_case",
    {
      description: "Patch a Docket test",
      inputSchema: {
        testId: z.string(),
        payload: z.record(z.string(), z.unknown()),
      },
    },
    async ({ testId, payload }) => {
      try {
        const { data } = await api.patch(`/api/tests/${testId}`, payload);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return toolErr(e);
      }
    }
  );

  server.registerTool(
    "run_test_suite",
    { description: "Run a Docket test suite", inputSchema: { suiteId: z.string() } },
    async ({ suiteId }) => {
      try {
        const { data } = await api.post(`/api/suites/${suiteId}/run`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return toolErr(e);
      }
    }
  );

  server.registerTool(
    "get_test_results",
    { description: "Fetch results for a Docket run", inputSchema: { runId: z.string() } },
    async ({ runId }) => {
      try {
        const { data } = await api.get(`/api/runs/${runId}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return toolErr(e);
      }
    }
  );

  return server;
}

const app = createMcpExpressApp();

/** Active MCP transports keyed by session id (streamable HTTP + legacy SSE). */
const transports: Record<string, StreamableHTTPServerTransport | SSEServerTransport> = {};

async function handleStreamableMcp(req: Request, res: Response) {
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  try {
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      const existing = transports[sessionId];
      if (existing instanceof StreamableHTTPServerTransport) {
        transport = existing;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: Session uses a different transport (SSE).",
          },
          id: null,
        });
        return;
      }
    } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
        },
      });
      transport.onclose = () => {
        const sid = transport!.sessionId;
        if (sid && transports[sid]) delete transports[sid];
      };
      const server = getServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID or initialize request.",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP streamable HTTP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

/** Cursor / clients may use `/`, `/mcp`, or Streamable HTTP — mount both. */
app.all("/mcp", handleStreamableMcp);
app.all("/", handleStreamableMcp);

/** Deprecated SSE transport fallback (Cursor tries this if Streamable HTTP fails). */
app.get("/sse", async (req, res) => {
  try {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    res.on("close", () => {
      delete transports[transport.sessionId];
    });
    const server = getServer();
    await server.connect(transport);
  } catch (error) {
    console.error("SSE setup error:", error);
    if (!res.headersSent) res.status(500).send("SSE setup failed");
  }
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  const existing = sessionId ? transports[sessionId] : undefined;
  if (existing instanceof SSEServerTransport) {
    await existing.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).send("No SSE transport for sessionId");
  }
});

/**
 * Optional REST helpers (same behavior as before MCP wiring).
 */
app.post("/get_test_case", async (req, res) => {
  try {
    const { testId } = req.body;
    const { data } = await api.get(`/api/tests/${testId}`);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/update_test_step", async (req, res) => {
  try {
    const { testId, stepId, payload } = req.body;
    const { data } = await api.patch(`/api/tests/${testId}/steps/${stepId}`, payload);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/update_test_case", async (req, res) => {
  try {
    const { testId, payload } = req.body;
    const { data } = await api.patch(`/api/tests/${testId}`, payload);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/run_test_suite", async (req, res) => {
  try {
    const { suiteId } = req.body;
    const { data } = await api.post(`/api/suites/${suiteId}/run`);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/get_test_results", async (req, res) => {
  try {
    const { runId } = req.body;
    const { data } = await api.get(`/api/runs/${runId}`);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const PORT = 3333;
app.listen(PORT, () => {
  console.log(`Docket MCP — Streamable HTTP: http://localhost:${PORT}/ and http://localhost:${PORT}/mcp`);
  console.log(`Legacy SSE: GET http://localhost:${PORT}/sse — REST POST routes unchanged`);
});
