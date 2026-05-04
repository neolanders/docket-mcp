# docket-mcp

[MCP](https://modelcontextprotocol.io/)-compatible HTTP server for [Docket](https://www.docketqa.com/): register tools for tests, steps, suites, and run results, plus optional plain REST routes for scripts.

## Cursor and other MCP clients

1. Start the server: `npm start` (listens on port **3333**).
2. In Cursor **Settings → MCP**, add a server with type **HTTP** and URL:

   - `http://127.0.0.1:3333/` **or** `http://127.0.0.1:3333/mcp`

   The app implements **Streamable HTTP** on both paths. If a client falls back to legacy HTTP+SSE, the server also exposes `GET /sse` and `POST /messages?sessionId=…`.

3. Ensure `.env` has valid `DOCKET_BASE_URL` and `DOCKET_API_KEY` so tool calls can reach Docket.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (20 LTS recommended)
- A Docket account and API credentials

## Setup

```bash
git clone https://github.com/neolanders/docket-mcp.git
cd docket-mcp
npm install
```

## Configuration

Copy the example env file and edit it:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `DOCKET_BASE_URL` | Docket app URL (default: `https://app.docketqa.com`) |
| `DOCKET_API_KEY` | Your Docket API key |

Get the API key from the Docket web app: **Dashboard → CI/CD** (not the general Settings webhook secret). See [Docket CI integration](https://docs.docketqa.com/essentials/ci-integration) and the [API reference](https://docs.docketqa.com/api-reference/introduction).

If requests return `401`, confirm in Docket’s docs whether your plan expects `Authorization: Bearer` or another header (e.g. `X-API-KEY`) and adjust `index.ts` if needed.

## Run

```bash
npm start
```

The server listens on **http://localhost:3333** by default.

## HTTP API

All routes accept **POST** with **JSON** bodies.

| Route | Body | Purpose |
|-------|------|---------|
| `/get_test_case` | `{ "testId": "..." }` | Fetch a test |
| `/update_test_step` | `{ "testId", "stepId", "payload" }` | Patch a step |
| `/update_test_case` | `{ "testId", "payload" }` | Patch a test |
| `/run_test_suite` | `{ "suiteId": "..." }` | Run a suite |
| `/get_test_results` | `{ "runId": "..." }` | Fetch run details |

Example:

```bash
curl -s -X POST http://localhost:3333/get_test_case \
  -H "Content-Type: application/json" \
  -d '{"testId":"YOUR_TEST_ID"}'
```

## Security

- Never commit `.env` or real API keys (`.env` is gitignored).
- Do not expose this service to the public internet without authentication and TLS.

## License

MIT — see [LICENSE](./LICENSE).
