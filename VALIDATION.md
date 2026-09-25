# Validation — September 25, 2026

- Node.js 20.19.0: all nine automated tests passed.
- Real MCP SDK client: initialization, tool discovery, and tool invocation passed over local Streamable HTTP.
- Original question-set comparison: all nine questions exactly match the local Python implementation.
- Live end-to-end smoke test: local MCP → TypeSafe System One → validated MCP result passed with `jev-1.13.0` and nine answers.
- The live smoke test used synthetic evidence and the existing credential injected into the server process environment. No credential was printed, copied into this project, or sent to ChatGPT.
- No trading/order operations were invoked. No deployment or ChatGPT connection was performed.
- Docker image built successfully from the supplied Dockerfile and lockfile. The build's npm audit reported zero known dependency vulnerabilities.
- All nine automated tests also passed inside the image on Linux/Node.js 22.
- The production container passed external HTTP checks for health, MCP initialization, discovery of only `jev_classify`, and tool invocation.
- Without a secret, container health returned 503 and classification failed closed. With the runtime-injected secret, health returned 200 and a live TypeSafe call returned `jev-1.13.0` with nine answers.
- Host/Origin guards and unsupported-method handling passed. The container ran as a non-root user, emitted no application logs, and stopped gracefully.
- Image configuration contained no TypeSafe key; local secret files were absent from the image. Checked response bodies and logs contained no credential.
- Disposable test containers were stopped and automatically removed. The local image remains tagged `jev-readonly-mcp:local-test`. No cloud deployment was performed.

Run `npm test` to repeat offline checks. Run `npm run smoke` with the server-side secret configured to repeat the live check (consumes TypeSafe quota).
