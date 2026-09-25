import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/server.js';
import { createClassifier } from '../src/classifier.js';
import { categories, ENDPOINT, MODEL, QUESTIONS } from '../src/schemas.js';

const apiKey = 'test-secret-never-return-this';
const state = {
  ticker: 'EXAMPLE', company: 'Example Corp', market_context: 'Market lower.',
  sector_context: 'Peers lower.', evidence: [{ source: 'Synthetic fixture', published: '2026-09-25', headline: 'Sector declines', snippet: 'Peers declined together.' }],
};
function validResponse() {
  return { model: MODEL, answers: Object.fromEntries(Object.entries(QUESTIONS).map(([name, question]) => [
    name, question.type === 'choice' ? {
      type: 'choice', choice: 'sector_sympathy', confidence: 0.9,
      probabilities: Object.fromEntries(categories.map(category => [category, category === 'sector_sympathy' ? 1 : 0])),
    } : { type: 'noul', noul: 0.1 },
  ])) };
}
async function fixture(context, options = {}) {
  const server = createApp({ apiKey, fetchImpl: async () => Response.json(validResponse()), ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return base;
}
async function connect(context, base) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  context.after(() => client.close());
  return client;
}

test('real MCP client initializes, discovers only read-only jev_classify, and calls System One', async context => {
  let requests = 0;
  const base = await fixture(context, { fetchImpl: async (url, options) => {
    requests += 1;
    assert.equal(url, ENDPOINT);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload, { model: MODEL, questions: QUESTIONS, state });
    assert.ok(!options.body.includes(apiKey));
    return Response.json({ ...validResponse(), debug: apiKey });
  } });
  const client = await connect(context, base);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['jev_classify']);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[0].annotations.destructiveHint, false);
  assert.deepEqual(tools[0].inputSchema.required.sort(), Object.keys(state).sort());
  const result = await client.callTool({ name: 'jev_classify', arguments: state });
  assert.ok(!result.isError);
  assert.deepEqual(result.structuredContent, validResponse());
  assert.ok(!JSON.stringify(result).includes(apiKey));
  assert.equal(requests, 1);
});

test('health is secret-free and reflects missing configuration', async context => {
  const base = await fixture(context, { apiKey: '' });
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'not_ready' });
  const client = await connect(context, base);
  const result = await client.callTool({ name: 'jev_classify', arguments: state });
  assert.equal(result.isError, true);
});

test('invalid input and unknown tools never reach TypeSafe', async context => {
  let calls = 0;
  const base = await fixture(context, { fetchImpl: async () => { calls += 1; throw new Error('unexpected'); } });
  const client = await connect(context, base);
  for (const args of [{ ...state, ticker: '../bad' }, { ...state, evidence: 'wrong' }, { ...state, api_key: 'client-key' }, { ...state, company: '' }]) {
    assert.equal((await client.callTool({ name: 'jev_classify', arguments: args })).isError, true);
  }
  assert.equal((await client.callTool({ name: 'place_order', arguments: {} })).isError, true);
  assert.equal(calls, 0);
});

test('health, method, JSON, size, host, and origin guards', async context => {
  const base = await fixture(context);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE' })).status, 405);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/health`, { headers: { Host: 'attacker.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(`${base}/health`, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(`${base}/health`, { headers: { Origin: 'null' } })).status, 403);
  for (const [body, status] of [['{bad', 400], [JSON.stringify({ large: 'a'.repeat(100000) }), 413]]) {
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: 'Invalid request.' });
  }
});

test('upstream failures and malicious responses do not expose credentials', async () => {
  const malformed = validResponse();
  malformed.answers.primary_catalyst.choice = apiKey;
  const cases = [
    async () => new Response(apiKey, { status: 401 }),
    async () => new Response(apiKey, { status: 429 }),
    async () => new Response(apiKey, { status: 529 }),
    async () => { throw new Error(apiKey); },
    async () => new Response(apiKey),
    async () => new Response('x'.repeat(65537)),
    async () => Response.json(malformed),
    async () => Response.json({ model: MODEL, answers: {} }),
    async () => Response.json({ ...validResponse(), model: apiKey }),
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(createClassifier({ apiKey, fetchImpl })(state), error => {
      assert.ok(!String(error).includes(apiKey));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('rejects missing probabilities, invalid ranges and contradictory distributions', async () => {
  const mutations = [
    result => { delete result.answers.primary_catalyst.probabilities.unclear; },
    result => { result.answers.evidence_sufficient.noul = 1.1; },
    result => { result.answers.primary_catalyst.confidence = '0.8'; },
    result => { result.answers.primary_catalyst.probabilities.unclear = 0.5; },
    result => { result.answers.primary_catalyst.choice = 'unclear'; },
  ];
  for (const mutate of mutations) {
    const result = validResponse();
    mutate(result);
    await assert.rejects(createClassifier({ apiKey, fetchImpl: async () => Response.json(result) })(state));
  }
});

test('timeout aborts upstream without exposing its error', async () => {
  const classify = createClassifier({ apiKey, timeoutMs: 10, fetchImpl: async (url, { signal }) => {
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error(apiKey))));
  } });
  await assert.rejects(classify(state), /timed out/);
});

test('global budget expires after one hour and caps concurrency', async () => {
  let time = 100000;
  const classify = createClassifier({ apiKey, maxCalls: 1, now: () => time, fetchImpl: async () => Response.json(validResponse()) });
  await classify(state);
  await assert.rejects(classify(state), /Hourly/);
  time += 3600001;
  await classify(state);
  const releases = [];
  const parallel = createClassifier({ apiKey, fetchImpl: async () => {
    await new Promise(resolve => releases.push(resolve));
    return Response.json(validResponse());
  } });
  const running = [parallel(state), parallel(state)];
  await assert.rejects(parallel(state), /busy/);
  releases.forEach(release => release());
  await Promise.all(running);
});

test('successful response strips all unapproved upstream fields', async () => {
  const response = validResponse();
  response.answers.evidence_sufficient.debug = apiKey;
  response.answers.extra = { secret: apiKey };
  response.usage = { secret: apiKey };
  const result = await createClassifier({ apiKey, fetchImpl: async () => Response.json(response) })(state);
  assert.deepEqual(result, validResponse());
});
