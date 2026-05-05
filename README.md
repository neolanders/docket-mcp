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
| `DOCKET_BASE_URL` | [HTTP API](https://docs.docketqa.com/api-reference/introduction) base (default: `https://api.docketqa.com` — not the `app` web origin) |
| `DOCKET_API_KEY` | API key from **Dashboard → CI/CD** |

The server sends `X-API-KEY` to `api.docketqa.com` as in the [API introduction](https://docs.docketqa.com/api-reference/introduction). `get_test_case` uses `POST /test_group_run/trigger_run` and **starts a run**; use that response or `get_test_results` with `GET /test_run/{id}`.

## Run

```bash
npm start
```

The server listens on **http://localhost:3333** by default.

## Sample MCP usage

In Cursor (or any MCP client connected to this server), you ask in plain language; the assistant maps your request to the tools below.

| What you want | Tool | Typical arguments |
|----------------|------|---------------------|
| Load the latest blueprint snapshot for a test (starts a run on Docket) | `get_test_case` | `testId`: blueprint id as a string, e.g. `"2734"` |
| Merge new fields into one step (then apply in the Docket editor if needed) | `update_test_step` | `testId`, `stepId` (step number or internal step id), `payload`: partial step object |
| Run every test in a suite | `run_test_suite` | `suiteId`: test suite / category id from Docket |
| Poll one test run | `get_test_results` | `runId`: from `trigger_run` → `test_runs[].id` |

### Example: “Update step 12 of test 2734 to fix action issue”

1. Use **`update_test_step`** with the blueprint id, step number, and the fields you want to change (for example, switch a flaky recorded click to an AI step with clearer text):

   ```json
   {
     "testId": "2734",
     "stepId": "12",
     "payload": {
       "type": "act",
       "action": "In the manual control alerts table, click the row for the system under test.",
       "action_cache": null
     }
   }
   ```

2. The tool returns a **`merged_step`** JSON object. If your Docket tier does not expose a public “save step” API, open the test in [app.docketqa.com](https://app.docketqa.com), edit step 12, and paste or mirror those fields.

### Example: “Show me test 2734’s steps”

Use **`get_test_case`** with `testId` **`"2734"`**. This triggers a run and returns `blueprint_metadata.steps` in the response—use sparingly on busy suites.

### Example: “How did run 43376 go?”

Use **`get_test_results`** with `runId` **`"43376"`** (use an id returned from `get_test_case` / `trigger_run`).

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
