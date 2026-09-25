import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/server.js';

if (!process.env.TYPESAFE_API_KEY?.trim()) {
  process.stderr.write('Configure TYPESAFE_API_KEY in the server environment first.\n');
  process.exit(1);
}
const server = createApp().listen(0, '127.0.0.1');
const client = new Client({ name: 'jev-smoke', version: '1.0.0' });
try {
  await once(server, 'listening');
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
  const tools = await client.listTools();
  if (tools.tools.length !== 1 || tools.tools[0].name !== 'jev_classify') throw new Error();
  const result = await client.callTool({ name: 'jev_classify', arguments: {
    ticker: 'EXAMPLE', company: 'Example Corp',
    market_context: 'Synthetic test: broad market is modestly lower.',
    sector_context: 'Synthetic test: peer companies are also lower after a sector note.',
    evidence: [{ source: 'Synthetic test fixture', published: '2026-09-25', headline: 'Analyst cuts target on Example Corp', snippet: 'One analyst lowered the price target while keeping its rating unchanged.' }],
  } });
  if (result.isError) {
    process.stderr.write('Live MCP classification failed. Check server secret and TypeSafe availability.\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(`Live MCP classification passed: ${result.structuredContent.model}; ${Object.keys(result.structuredContent.answers).length} answers.\n`);
  }
} catch {
  process.stderr.write('Live MCP smoke test failed.\n');
  process.exitCode = 1;
} finally {
  await client.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
