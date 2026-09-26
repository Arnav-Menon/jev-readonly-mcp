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

## Deploy to Vercel

The existing Docker image remains useful for local validation. To repeat the offline container tests from this directory:

```sh
docker build -t jev-readonly-mcp:local-test .
docker run --rm --volume "$PWD/test:/app/test:ro" --entrypoint node jev-readonly-mcp:local-test --test
```

To start the production container with an already configured environment key (the value is not included in command arguments):

```sh
docker run --rm --publish 127.0.0.1:3000:3000 --env TYPESAFE_API_KEY jev-readonly-mcp:local-test
```

Check `http://127.0.0.1:3000/health` from another terminal. The process runs as the non-root `node` user. See `VALIDATION.md` for the completed checks.

The service is an Express app detected by Vercel and runs as an on-demand Function. `vercel.json` sets a 60-second per-request ceiling. Each call to `jev_classify` makes one TypeSafe request with a 20-second application timeout. A shadow workflow that runs for more than 15 minutes is still fine if it makes separate MCP calls; the MCP service does not need to stay running for the entire workflow. There is no server process to keep awake, and periodic dummy requests do not guarantee warm capacity. Do not add a keep-alive cron.

This checkout is prepared for Vercel, but no public deployment has been created yet.

1. Open the Vercel dashboard and choose **Add New → Project**. Import the GitHub repository **`Arnav-Menon/jev-readonly-mcp`**. If Vercel asks for a Root Directory, leave it at the repository root.
2. In project settings, add **`TYPESAFE_API_KEY`** as an encrypted environment variable for **Production** (and Preview only if you intend to test previews). Paste the existing TypeSafe key directly into Vercel's secret field. Never add it to Git, chat, build arguments, or the URL.
3. Add **`ALLOWED_ORIGINS`** with the exact ChatGPT web origin only if ChatGPT sends an `Origin` header. Start with `https://chatgpt.com`; add `https://chat.openai.com` only if that is the origin your connection uses. Separate origins with commas. Leave this unset otherwise.
4. Deploy from the Vercel dashboard. Vercel recognizes the default Express export in `src/server.js`; no keep-alive schedule or Docker service is needed. `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` are accepted automatically for Host validation. For a custom domain, add its exact hostname to `ALLOWED_HOSTS`.
5. Open the deployment's `/health` URL; expect `{"status":"ok"}`. A `503` means the server-side key was not configured for that deployment. The MCP endpoint is the same deployment URL ending in **`/mcp`**.

Do not configure `TYPESAFE_ENDPOINT`: the only outbound inference endpoint is hard-coded to TypeSafe, and redirects are refused. The 60-second Vercel request cap applies to each HTTP invocation, not the total duration of the external shadow workflow. Hobby's current function limit is 300 seconds with Fluid Compute, so this service's 20-second upstream deadline leaves headroom; verify current plan limits before changing that timeout.

**Access model:** this minimal version uses MCP **No authentication**. Anyone able to reach the endpoint can submit evidence and consume your TypeSafe quota. It is not a private authenticated service. The app limits classification attempts globally to 60 per rolling hour and two concurrently, per process; the limit resets on restart and is not a durable billing cap. Keep one instance. Use a TypeSafe spending limit if available. Add a standards-compatible OAuth layer before using it as a private multi-user service. Do not put an API key in the URL as a substitute for authentication.

## Connect the deployed service to ChatGPT

Current connection instructions, checked September 25, 2026. Custom MCP app availability depends on plan and workspace policy. OpenAI currently supports full MCP app creation on Business and Enterprise/Edu; Pro users can connect read/fetch-only MCPs in developer mode. This server exposes only a read-only tool. See [OpenAI's current availability and setup instructions](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).

1. In ChatGPT web, open **Settings → Security and login** and enable **Developer mode**. Depending on your plan/workspace, the control may be under **Settings → Apps → Advanced settings** or **Workspace settings → Apps → Create**; an administrator may need to enable it.
2. Open **Settings → Apps → Create** (or **Workspace settings → Apps → Create**) and create an app named **Jev Classifier**.
3. Enter the description: **Read-only classification of supplied stock-decline evidence using Jev.**
4. Paste the deployed HTTPS MCP endpoint ending in `/mcp`. When prompted for authentication, select **No authentication**.
5. Select **Scan Tools**. Confirm that the only discovered action is **`jev_classify`** and that it is read-only, then create/save the app.
6. Start a new chat, select **Jev Classifier** from the tools/apps menu, and ask it to classify the synthetic example packet in this README. Request the model, primary catalyst, confidence, full probabilities, and all eight Noul values.
7. After changing tool metadata, redeploy and use the app's **Refresh** action before retesting.

Do not provide the TypeSafe key to ChatGPT; it stays in Vercel. The deployed endpoint is public and has no OAuth authentication in this minimal version. Anyone who discovers the URL can submit requests against your TypeSafe quota; the in-memory hourly limiter is not a durable global quota on a serverless host. Do not use this publicly until you are comfortable with that exposure or add authentication and a durable rate limit.

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
- [Vercel Express guide](https://vercel.com/docs/frameworks/backend/express): default app export and serverless behavior.
- [Vercel Function limits](https://vercel.com/docs/functions/limitations): request-duration limits by plan.
- [Vercel MCP deployment](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel): remote MCP guidance.
