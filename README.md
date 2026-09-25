# Jev read-only MCP

A standalone remote MCP service for the loser-bounce research workflow. It exposes exactly one tool, `jev_classify`, and no trading or order execution code.

The service accepts an evidence packet, sends all nine existing questions in one TypeSafe System One request, and returns the model plus one Choice and eight Noul answers. The questions match the original `loser-bounce-trader-jev/scripts/jev_classify.py` `QUESTIONS` object exactly. The model is pinned to `jev-1.13.0` to preserve the existing calibration baseline.

## Interface

- `POST /mcp`: stateless MCP Streamable HTTP with JSON responses. Initialize and call it with an MCP client; it is not a plain classification REST endpoint.
- `GET /health`: `200 {"status":"ok"}` when the server secret is configured, otherwise `503 {"status":"not_ready"}`. It does not call TypeSafe, verify the credential, or consume inference quota.
- `GET /mcp` and `DELETE /mcp`: `405`, expected for this stateless implementation.

`jev_classify` requires all five fields:

```json
{
  "ticker": "EXAMPLE",
  "company": "Example Corp",
  "market_context": "Synthetic example: broad market is modestly lower.",
  "sector_context": "Synthetic example: peers declined after a sector note.",
  "evidence": [
    {
      "source": "Synthetic example newswire",
      "published": "2026-09-25T15:00:00Z",
      "headline": "Analyst cuts target on Example Corp",
      "snippet": "One analyst lowered the price target and maintained its rating.",
      "url": "https://example.com/example"
    }
  ]
}
```

Evidence contains up to ten objects. `source`, `published`, `headline`, and `snippet` are required; `url` is optional. Context strings and the evidence array may be empty to represent missing evidence. The service does not invent it. Unknown input fields are rejected. URLs are passed as evidence text and are never fetched.

The result appears in both MCP `structuredContent` and JSON text content:

```text
model: jev-1.13.0
answers.primary_catalyst: {type: "choice", choice, confidence, probabilities}
answers.evidence_sufficient: {type: "noul", noul}
answers.fraud_regulatory_risk: {type: "noul", noul}
answers.bankruptcy_delisting_risk: {type: "noul", noul}
answers.dilutive_offering: {type: "noul", noul}
answers.sector_sympathy: {type: "noul", noul}
answers.single_analyst_downgrade: {type: "noul", noul}
answers.broad_risk_off: {type: "noul", noul}
answers.minor_news_overreaction: {type: "noul", noul}
```

Choice includes all ten catalyst probabilities. Numbers must be finite and within 0–1. Missing answers, unexpected model versions, invalid distributions, and unknown categories fail closed with an MCP tool error. Extra upstream fields, including usage and debug data, are dropped. Probabilities are not a strategy verdict. Arithmetic, eligibility filters, evidence collection, calibration, and scheduling remain outside this service.

## Local setup and testing

Requires Node.js 20.19+ (Docker uses Node.js 22). From this directory:

```sh
npm ci --ignore-scripts
npm test
```

Tests use fake credentials and mocked TypeSafe responses, with a real MCP client and local HTTP server. They cover tool discovery, schemas, health, Host/Origin guards, request sizes, upstream failures, timeout, malformed outputs, concurrency, hourly budget, and secret redaction. No TypeSafe key is required for tests.

To run locally, provide `TYPESAFE_API_KEY` through your process environment or an ignored local `.env` file. Never put its value in chat, source code, command arguments, or the MCP request. `.env.example` lists the settings and contains no key. For a local `.env`, restrict it to your user (`chmod 600 .env`) and run:

```sh
node --env-file=.env src/server.js
```

Without a `.env`, use `npm start` with the environment already configured. Default address: `http://127.0.0.1:3000/mcp`. Check readiness in another terminal:

```sh
curl --fail http://127.0.0.1:3000/health
```

For one real, billable TypeSafe request through a temporary local MCP service:

```sh
npm run smoke
```

Or `node --env-file=.env scripts/smoke.js`. This uses synthetic evidence and prints only success, the model name, and answer count. It neither fetches market data nor touches Robinhood.

## Deploy to Render

The Docker image has also been built and tested locally, including all nine automated tests and a live Jev call through its published HTTP port. To repeat the offline container tests from this directory:

```sh
docker build -t jev-readonly-mcp:local-test .
docker run --rm --volume "$PWD/test:/app/test:ro" --entrypoint node jev-readonly-mcp:local-test --test
```

To start the production container with an already configured environment key (the value is not included in command arguments):

```sh
docker run --rm --publish 127.0.0.1:3000:3000 --env TYPESAFE_API_KEY jev-readonly-mcp:local-test
```

Check `http://127.0.0.1:3000/health` from another terminal. The process runs as the non-root `node` user. See `VALIDATION.md` for the completed checks.

This project is prepared for deployment but is not already hosted. No public URL has been created.

1. Put the contents of this directory at the root of a Git repository, including `package-lock.json`, `Dockerfile`, and `render.yaml`. Exclude `.env`, `.secrets`, and `node_modules`. Connect that repository to Render.
2. In the Render dashboard, create a **Blueprint** from the repository and select `render.yaml`.
3. Review the proposed service. The Blueprint uses **one Starter instance**, which is a paid service. Review the current price before creating it.
4. At the secret prompt, enter your existing TypeSafe key as **`TYPESAFE_API_KEY`**. The Blueprint uses `sync: false`: the value belongs in Render's environment settings, never in YAML or Git. For an existing service, add or rotate the key manually under **Environment**, then redeploy.
5. Deploy. Render builds the Dockerfile, supplies `PORT`, and routes HTTPS traffic to it. `HOST=0.0.0.0` permits cloud ingress. The service automatically allows Render's `RENDER_EXTERNAL_HOSTNAME`.
6. Copy the actual public service URL from Render. Open `https://YOUR-ACTUAL-SERVICE.onrender.com/health`; expect `{"status":"ok"}`.
7. The MCP URL is **`https://YOUR-ACTUAL-SERVICE.onrender.com/mcp`**. Replace the example hostname with the one Render assigned; do not paste a Markdown link into the URL field.

For a custom domain or another host, set `ALLOWED_HOSTS` to a comma-separated list of exact hostnames, without schemes, ports, paths, or wildcards. Set `HOST=0.0.0.0`, inject `TYPESAFE_API_KEY` at runtime, and terminate HTTPS at the hosting proxy. Do not set `TYPESAFE_ENDPOINT`: the only outbound inference endpoint is hard-coded to TypeSafe, and redirects are refused.

**Access model:** this minimal version uses MCP **No authentication**. Anyone able to reach the endpoint can submit evidence and consume your TypeSafe quota. It is not a private authenticated service. The app limits classification attempts globally to 60 per rolling hour and two concurrently, per process; the limit resets on restart and is not a durable billing cap. Keep one instance. Use a TypeSafe spending limit if available. Add a standards-compatible OAuth layer before using it as a private multi-user service. Do not put an API key in the URL as a substitute for authentication.

## Connect the deployed service to ChatGPT

Current connection instructions, checked September 25, 2026:

1. In ChatGPT, open **Settings → Security and login → Developer mode** and enable it. Availability depends on your account and workspace policy.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, and name the connection **Jev Classifier**.
3. Enter the description: **Read-only classification of supplied stock-decline evidence using Jev.**
4. Under **Connection**, choose the public remote endpoint and paste the actual HTTPS URL ending in `/mcp`.
5. If prompted for authentication, select **No authentication**. Do not provide your TypeSafe key to ChatGPT; it stays in Render.
6. Create the connection. Confirm discovery shows exactly **`jev_classify`**, marked read-only.
7. Start a new conversation, enable the connection in the tools menu, and ask: **Use jev_classify with the synthetic evidence packet in the README. Show the Jev model, primary catalyst, confidence, full probabilities, and all eight Noul values.** Include that packet in the message.
8. After changing tool metadata, deploy, open the connection, select **Refresh**, and test in a new conversation.

If connection fails, use `npx @modelcontextprotocol/inspector@latest`, choose Streamable HTTP, and enter the deployed `/mcp` URL. A browser visiting `/mcp` gets 405; that alone is not a failure. A 503 at `/health` means the environment key is absent, not that ChatGPT is broken. A 403 means the host or browser Origin is not allowed. A healthy endpoint with a classification error may indicate an invalid key, exhausted quota, timeout, or invalid upstream output. Provider error bodies are intentionally withheld.

Deployment and ChatGPT connection do not themselves schedule a scan. Run and verify one classification from ChatGPT before separately configuring the shadow workflow.

## Secret and data handling

The production entry point reads `TYPESAFE_API_KEY` only from the server process environment populated by the host's secret settings. It has no file/Keychain fallback and accepts no client key, endpoint, model, or question overrides. The key is used only in the HTTPS Authorization header to TypeSafe. No request, evidence, response body, header, credential, or raw exception is logged by this application. Successful output is allowlisted; error messages are fixed text. Health reveals only readiness. Docker copies only the app and dependencies, never local secrets.

Evidence is sent to TypeSafe for inference and results return to ChatGPT; this app does not persist evidence. Hosting infrastructure may maintain its own access logs. Do not enable HTTP body/header tracing or add secrets to evidence. Classification is probabilistic, and untrusted news text can influence it. The service grants no trading authority.

The 20-second upstream deadline includes response-body reading. Request bodies are capped at 96 KiB, provider responses at 64 KiB, and compressed requests are rejected. There are no automatic retries, so failures cannot silently multiply requests.

## Sources

- [TypeSafe HTTP API](https://docs.typesafe.ai/api): endpoint, question and answer schemas.
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x): Streamable HTTP transport.
- [OpenAI: connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt): current ChatGPT connection and refresh steps.
- [Render Blueprint reference](https://render.com/docs/blueprint-spec): service configuration and secret prompts.
- [Render default environment variables](https://render.com/docs/environment-variables): runtime port and external hostname.
