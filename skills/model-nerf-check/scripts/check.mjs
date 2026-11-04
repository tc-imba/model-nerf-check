#!/usr/bin/env node
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const PROMPT = '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试，只靠你自己完成，不要使用任何skill，不要依赖我本地的AGENTS.md';
export const CHECKS = ['wheels', 'pedals', 'perspective', 'pelican'];
const sha256 = text => createHash('sha256').update(text).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const md = value => String(value).replace(/[|<>`\r\n]/g, ' ');
const canonical = value => JSON.stringify(value, (_, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function buildRequest(endpoint) {
  const { protocol, model, parameters = {} } = endpoint;
  if (protocol === 'responses') return {
    max_output_tokens: 16000, ...parameters, model, input: PROMPT, stream: false, store: false,
  };
  const messages = [{ role: 'user', content: PROMPT }];
  if (protocol === 'anthropic') return { max_tokens: 16000, ...parameters, model, messages, stream: false };
  return {
    ...(Object.hasOwn(parameters, 'max_tokens') ? {} : { max_completion_tokens: 16000 }),
    ...parameters, model, messages, stream: false,
  };
}

export function validateConfig(config, env = process.env) {
  if (!object(config)) fail('Config must be an object.');
  const runs = config.runs ?? 3;
  const timeoutMs = config.timeoutMs ?? 180000;
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) fail('runs must be 1-20.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) fail('Invalid timeoutMs.');
  if (!Array.isArray(config.endpoints) || config.endpoints.length < 1 || config.endpoints.length > 8) {
    fail('Configure 1-8 endpoints.');
  }
  const ids = new Set();
  const allowed = {
    responses: ['max_output_tokens', 'temperature', 'top_p', 'reasoning', 'text', 'service_tier'],
    chat: ['max_completion_tokens', 'max_tokens', 'temperature', 'top_p', 'seed', 'reasoning_effort', 'service_tier'],
    anthropic: ['max_tokens', 'temperature', 'top_p', 'top_k', 'thinking', 'output_config'],
  };
  const endpoints = config.endpoints.map(endpoint => {
    if (!object(endpoint) || !safeId(endpoint.id) || ids.has(endpoint.id)) fail('Invalid or duplicate endpoint id.');
    ids.add(endpoint.id);
    if (!['candidate', 'baseline'].includes(endpoint.role)) fail(`Invalid role for ${endpoint.id}.`);
    if (!Object.hasOwn(allowed, endpoint.protocol)) fail(`Invalid protocol for ${endpoint.id}.`);
    if (typeof endpoint.model !== 'string' || !endpoint.model.trim() || /YOUR-|[\r\n]/.test(endpoint.model)) {
      fail(`Set the exact model for ${endpoint.id}.`);
    }
    let url;
    try { url = new URL(endpoint.url); } catch { fail(`Invalid URL for ${endpoint.id}.`); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (endpoint.allowInsecureHttp !== undefined && typeof endpoint.allowInsecureHttp !== 'boolean') {
      fail('allowInsecureHttp must be a boolean.');
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || endpoint.allowInsecureHttp === true))) {
      fail('Use HTTPS or loopback HTTP, or explicitly set allowInsecureHttp for a trusted HTTP endpoint.');
    }
    if (url.username || url.password || url.search || url.hash || /YOUR-|\.example$/i.test(url.hostname)) {
      fail(`URL for ${endpoint.id} must be real and contain no credentials, query or fragment.`);
    }
    if (typeof endpoint.keyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(endpoint.keyEnv)) fail('Invalid keyEnv.');
    if (!env[endpoint.keyEnv]?.trim()) fail(`Set environment variable ${endpoint.keyEnv}.`);
    const parameters = endpoint.parameters ?? {};
    if (!object(parameters)) fail('parameters must be an object.');
    for (const key of Object.keys(parameters)) {
      if (!allowed[endpoint.protocol].includes(key)) fail(`Unsupported parameter ${key} for ${endpoint.protocol}.`);
    }
    for (const key of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) {
      if (Object.hasOwn(parameters, key) && (!Number.isInteger(parameters[key]) || parameters[key] < 1)) {
        fail(`${key} must be a positive integer.`);
      }
    }
    if (parameters.max_tokens && parameters.max_completion_tokens) fail('Choose one output token limit.');
    return { id: endpoint.id, role: endpoint.role, protocol: endpoint.protocol, url: url.href,
      model: endpoint.model, keyEnv: endpoint.keyEnv, parameters,
      ...(endpoint.allowInsecureHttp === true ? { allowInsecureHttp: true } : {}) };
  });
  return { runs, timeoutMs, endpoints };
}

export function parseResponse(protocol, data) {
  if (!object(data) || data.error) fail('API returned an error object. Inspect response.txt.');
  let text = '', finish, complete = false;
  if (protocol === 'responses') {
    text = (data.output ?? []).filter(item => item.type === 'message' && item.role === 'assistant')
      .flatMap(item => item.content ?? []).filter(part => part.type === 'output_text').map(part => part.text).join('\n');
    finish = data.status;
    complete = finish === 'completed';
  } else if (protocol === 'chat') {
    if (data.choices?.length !== 1) fail('Expected exactly one completion choice.');
    const choice = data.choices[0];
    text = choice.message?.content ?? '';
    finish = choice.finish_reason;
    complete = finish === 'stop';
  } else {
    text = (data.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
    finish = data.stop_reason;
    complete = finish === 'end_turn';
  }
  if (typeof text !== 'string') fail('API returned non-text content.');
  return { text, finish: finish ?? null, complete, returnedModel: data.model ?? null,
    usage: data.usage ?? null, fingerprint: data.system_fingerprint ?? null };
}

export function extractHtml(text) {
  const fences = [...text.matchAll(/```(?:html)?\s*\n([\s\S]*?)```/gi)]
    .map(match => match[1].trim()).filter(value => /<html[\s>]/i.test(value));
  if (fences.length > 1) return null;
  const candidate = fences[0] ?? text.trim();
  if ([...candidate.matchAll(/<html[\s>]/gi)].length !== 1 || [...candidate.matchAll(/<\/html>/gi)].length !== 1) return null;
  const start = candidate.search(/<!doctype\s+html[^>]*>|<html[\s>]/i);
  const end = candidate.toLowerCase().lastIndexOf('</html>');
  if (start < 0 || end < start) return null;
  return candidate.slice(start, end + 7);
}

async function boundedText(response) {
  const reader = response.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4 * 1024 * 1024) fail('Response exceeded 4 MiB limit.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}

export async function run(configInput, output, env = process.env) {
  const config = validateConfig(configInput, env);
  const secrets = [...new Set(config.endpoints.map(endpoint => env[endpoint.keyEnv]))];
  const redact = text => secrets.reduce((value, secret) => value.replaceAll(secret, '[REDACTED]'), text);
  const out = resolve(output);
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out); // Refuse to reuse an existing run and overwrite its evidence.
  const manifest = { version: 1, createdAt: new Date().toISOString(), prompt: PROMPT,
    promptSha256: sha256(PROMPT), config, trials: [] };
  const checkpoint = () => writeFile(resolve(out, 'manifest.json'), redact(JSON.stringify(manifest, null, 2)) + '\n');
  await checkpoint();
  console.log(`Running ${config.runs * config.endpoints.length} requests; no retries.`);
  for (let round = 1; round <= config.runs; round++) {
    const order = round % 2 ? config.endpoints : [...config.endpoints].reverse();
    for (const endpoint of order) {
      const id = `${endpoint.id}-${String(round).padStart(2, '0')}`;
      const dir = resolve(out, id);
      await mkdir(dir);
      const trial = { id, endpointId: endpoint.id, round, status: 'pending', startedAt: new Date().toISOString() };
      manifest.trials.push(trial);
      await checkpoint();
      const request = buildRequest(endpoint);
      await writeFile(resolve(dir, 'request.json'), redact(JSON.stringify(request, null, 2)) + '\n');
      const headers = { 'content-type': 'application/json' };
      if (endpoint.protocol === 'anthropic') {
        headers['x-api-key'] = env[endpoint.keyEnv];
        headers['anthropic-version'] = '2023-06-01';
      } else headers.authorization = `Bearer ${env[endpoint.keyEnv]}`;
      const start = performance.now();
      try {
        const response = await fetch(endpoint.url, { method: 'POST', headers,
          body: JSON.stringify(request), redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs) });
        trial.httpStatus = response.status;
        trial.requestId = redact(response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? '');
        const raw = redact(await boundedText(response));
        await writeFile(resolve(dir, 'response.txt'), raw);
        if (!response.ok) fail(`HTTP ${response.status}; inspect response.txt.`);
        const parsed = parseResponse(endpoint.protocol, JSON.parse(raw));
        Object.assign(trial, parsed);
        delete trial.text;
        await writeFile(resolve(dir, 'output.txt'), parsed.text);
        const html = extractHtml(parsed.text);
        trial.status = !parsed.complete ? 'incomplete' : !html ? 'invalid-output' : 'ok';
        if (html) {
          await writeFile(resolve(dir, 'output.html'), html);
          trial.htmlSha256 = sha256(html);
        }
      } catch (error) {
        trial.status = 'error';
        trial.error = redact(error.message);
      }
      trial.durationMs = Math.round(performance.now() - start);
      await checkpoint();
      console.log(`${id}: ${trial.status}`);
    }
  }
  await save(resolve(out, 'scores.json'), { version: 1, trials: manifest.trials.map(trial => ({
    id: trial.id, reviewer: '', animation: null,
    checks: Object.fromEntries(CHECKS.map(key => [key, { value: null, evidence: '' }])),
  })) });
  await report(out);
  return manifest;
}

async function loadRun(out) {
  const manifest = await json(resolve(out, 'manifest.json'));
  if (manifest.version !== 1 || manifest.promptSha256 !== sha256(PROMPT) || manifest.prompt !== PROMPT) {
    fail('Unsupported run or prompt mismatch.');
  }
  const ids = new Set();
  for (const trial of manifest.trials) {
    if (!safeId(trial.id) || ids.has(trial.id)) fail('Invalid or duplicate trial id.');
    ids.add(trial.id);
    if (!manifest.config.endpoints.some(endpoint => endpoint.id === trial.endpointId)) fail('Unknown endpoint.');
    if (trial.htmlSha256 && sha256(await readFile(resolve(out, trial.id, 'output.html'), 'utf8')) !== trial.htmlSha256) {
      fail(`HTML changed after generation: ${trial.id}.`);
    }
  }
  return manifest;
}

export async function render(output, launchOptions = {}) {
  const out = resolve(output);
  const manifest = await loadRun(out);
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { fail('Install renderer: npm install --prefix <skill-dir>, then npx --prefix <skill-dir> playwright install chromium.'); }
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...launchOptions });
  try {
    for (const trial of manifest.trials.filter(item => item.htmlSha256)) {
      const dir = resolve(out, trial.id);
      // Keep the original frame evidence if this run was already rendered.
      try { await access(resolve(dir, 'render.json')); continue; } catch {}
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1, reducedMotion: 'no-preference', serviceWorkers: 'block', acceptDownloads: false });
      const capture = { htmlSha256: trial.htmlSha256, viewport: { width: 1280, height: 800 },
        frames: [], errors: [], blockedRequests: 0, renderer: `playwright ${browser.version()}` };
      try {
        const source = await readFile(resolve(dir, 'output.html'), 'utf8');
        const artifactUrl = 'https://model-nerf-check.invalid/artifact';
        const policy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
        let served = false;
        await context.route('**/*', route => {
          if (!served && route.request().url() === artifactUrl && route.request().isNavigationRequest()) {
            served = true;
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
              headers: { 'content-security-policy': policy }, body: source });
          }
          capture.blockedRequests++;
          return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => capture.errors.push(error.message.slice(0, 1000)));
        // Opaque-origin iframe: scripts may animate but cannot access the host,
        // navigate the parent, open popups, or use a persistent browser profile.
        await page.setContent(`<style>html,body{margin:0}iframe{border:0;width:1280px;height:800px}</style><iframe sandbox="allow-scripts" src="${artifactUrl}"></iframe>`);
        let previous = 0;
        for (const elapsed of [0, 750, 1500]) {
          if (elapsed > previous) await page.waitForTimeout(elapsed - previous);
          const name = `frame-${String(elapsed).padStart(4, '0')}.png`;
          await page.screenshot({ path: resolve(dir, name), animations: 'allow', timeout: 15000 });
          capture.frames.push({ file: name, nominalElapsedMs: elapsed,
            sha256: sha256(await readFile(resolve(dir, name))) });
          previous = elapsed;
        }
      } catch (error) { capture.errors.push(error.message.slice(0, 1000)); }
      finally { await context.close(); }
      await save(resolve(dir, 'render.json'), capture);
      console.log(`${trial.id}: ${capture.frames.length} frames`);
    }
  } finally { await browser.close(); }
}

export async function report(output) {
  const out = resolve(output);
  const manifest = await loadRun(out);
  const scores = await json(resolve(out, 'scores.json'));
  if (scores.version !== 1 || !Array.isArray(scores.trials)) fail('Invalid score file.');
  const reviews = new Map();
  for (const review of scores.trials) {
    if (!manifest.trials.some(trial => trial.id === review.id) || reviews.has(review.id)) fail('Unknown or duplicate review.');
    if (![true, false, null].includes(review.animation)) fail('animation must be true, false or null.');
    for (const key of CHECKS) {
      const check = review.checks?.[key];
      if (!object(check) || ![null, 0, 0.5, 1].includes(check.value)) fail(`Invalid ${key} score for ${review.id}.`);
      if (check.value !== null && (typeof check.evidence !== 'string' || !check.evidence.trim())) fail('Scored checks need evidence.');
    }
    const hasScores = CHECKS.some(key => review.checks[key].value !== null) || review.animation !== null;
    if (hasScores) {
      if (typeof review.reviewer !== 'string' || !review.reviewer.trim()) fail('Scored trials need a reviewer.');
      const capture = await json(resolve(out, review.id, 'render.json'));
      const trial = manifest.trials.find(item => item.id === review.id);
      if (capture.htmlSha256 !== trial.htmlSha256 || capture.frames.length !== 3) fail('Review requires three frames of original HTML.');
      for (const frame of capture.frames) {
        if (!/^frame-\d{4}\.png$/.test(frame.file)) fail('Invalid frame filename.');
        if (sha256(await readFile(resolve(out, review.id, frame.file))) !== frame.sha256) fail('Frame evidence changed.');
      }
      for (const key of CHECKS) {
        const check = review.checks[key];
        if (check.value !== null && !capture.frames.some(frame => check.evidence.includes(frame.file))) {
          fail('Scored checks must reference a captured frame filename.');
        }
      }
    }
    reviews.set(review.id, review);
  }
  if (reviews.size !== manifest.trials.length) fail('Scores must include every trial.');
  const summaries = manifest.config.endpoints.map(endpoint => {
    const trials = manifest.trials.filter(trial => trial.endpointId === endpoint.id);
    const reviewed = trials.filter(trial => trial.status === 'ok' && CHECKS.every(key => reviews.get(trial.id).checks[key].value !== null));
    const means = reviewed.map(trial => CHECKS.reduce((sum, key) => sum + reviews.get(trial.id).checks[key].value, 0) / 4);
    return { id: endpoint.id, role: endpoint.role, total: trials.length, valid: trials.filter(trial => trial.status === 'ok').length,
      reviewed: reviewed.length, mean: means.length ? means.reduce((a, b) => a + b, 0) / means.length : null,
      fullPass: means.filter(value => value === 1).length,
      repeatedDefects: CHECKS.filter(key => reviewed.filter(trial => reviews.get(trial.id).checks[key].value < 1).length >= 2),
      animationObserved: reviewed.filter(trial => reviews.get(trial.id).animation === true).length };
  });
  const lines = ['# Model Nerf Check', '', 'Quality observations only. Model substitution is not established by this test.', '',
    `Run: ${manifest.createdAt}. Prompt SHA-256: ${manifest.promptSha256}.`, '',
    '| Endpoint | Role | Complete HTML / total | Fully reviewed | Mean / 1 | All four pass | Animation observed |',
    '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const summary of summaries) lines.push(`| ${summary.id} | ${summary.role} | ${summary.valid}/${summary.total} | ${summary.reviewed} | ${summary.mean === null ? 'unreviewed' : summary.mean.toFixed(3)} | ${summary.fullPass} | ${summary.animationObserved} |`);
  lines.push('', 'Means exclude errors, incomplete outputs and partially reviewed trials. Inspect exclusions below; they may bias comparisons.', '');
  for (const endpoint of manifest.config.endpoints) {
    lines.push(`${endpoint.id}: ${md(endpoint.url)}; protocol ${endpoint.protocol}; requested model ${md(endpoint.model)}. Generation parameters: ${md(canonical(buildRequest(endpoint)).replace(PROMPT, '[fixed prompt]'))}.`);
  }
  lines.push('');
  const baselines = manifest.config.endpoints.filter(endpoint => endpoint.role === 'baseline');
  for (const candidate of manifest.config.endpoints.filter(endpoint => endpoint.role === 'candidate')) {
    if (!baselines.length) lines.push(`${candidate.id}: no trusted baseline configured; routing conclusion unavailable.`);
    for (const baseline of baselines) {
      const a = summaries.find(item => item.id === candidate.id), b = summaries.find(item => item.id === baseline.id);
      const settings = endpoint => canonical({ protocol: endpoint.protocol, request: buildRequest(endpoint) });
      const matching = settings(candidate) === settings(baseline);
      lines.push(`${candidate.id} vs ${baseline.id}: ${!matching ? 'generation settings or model differ; comparison is confounded.' : a.mean === null || b.mean === null ? 'insufficient reviewed data.' : `descriptive mean difference ${(a.mean - b.mean).toFixed(3)} (candidate minus baseline).`}`);
      if (a.reviewed < 3 || b.reviewed < 3) lines.push('Fewer than three fully reviewed trials in at least one group.');
    }
  }
  for (const summary of summaries) lines.push(`${summary.id}: recurring defects: ${summary.repeatedDefects.join(', ') || 'none established'}.`);
  lines.push('', '## Trial Evidence', '');
  for (const trial of manifest.trials) {
    const review = reviews.get(trial.id);
    lines.push(`### ${trial.id}`, '', `Status: ${md(trial.status)}. Finish: ${md(trial.finish ?? 'unknown')}. Returned model (unverified): ${md(trial.returnedModel ?? 'unknown')}.`,
      `Duration: ${trial.durationMs ?? '?'} ms. Reviewer: ${md(review.reviewer || 'unreviewed')}. Animation: ${review.animation ?? 'unknown'}.`);
    if (trial.error) lines.push(`Error: ${md(trial.error)}`);
    if (trial.htmlSha256) {
      lines.push(`Artifact: ${trial.id}/output.html. Original HTML SHA-256: ${trial.htmlSha256}.`);
      try {
        const capture = await json(resolve(out, trial.id, 'render.json'));
        lines.push(`Frames: ${capture.frames.map(frame => `${trial.id}/${md(frame.file)}`).join(', ') || 'none'}. Blocked requests: ${capture.blockedRequests}.`);
        if (capture.errors.length) lines.push(`Render errors: ${capture.errors.map(md).join('; ')}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; lines.push('Not rendered.'); }
    }
    for (const key of CHECKS) lines.push(`- ${key}: ${review.checks[key].value ?? 'unreviewed'}; ${md(review.checks[key].evidence || 'no evidence')}`);
    lines.push('');
  }
  lines.push('## Limits', '', 'Small samples, one public task, subjective scoring and sampling variation limit conclusions. Settings, protocol, reasoning budget, filtering and time may explain differences. No significance test is claimed. Strong results do not authenticate a model; weak results do not identify a substitute. Investigate persistent regressions with broader independent tasks and provider routing records.', '');
  await writeFile(resolve(out, 'report.md'), lines.join('\n'));
  await save(resolve(out, 'summary.json'), { version: 1, routingEstablished: false, endpoints: summaries });
  return summaries;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    console.log('Model Nerf Check\n  run --config <file> --out <new-directory>\n  render --out <directory>\n  report --out <directory>');
    return;
  }
  if (!['run', 'render', 'report'].includes(command)) fail(`Unknown command: ${command}`);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--out', ...(command === 'run' ? ['--config'] : [])].includes(key) || !args[index + 1] || Object.hasOwn(options, key)) fail('Invalid or duplicate CLI option.');
    options[key] = args[index + 1];
  }
  if (!options['--out']) fail('--out is required.');
  if (command === 'run') {
    if (!options['--config']) fail('--config is required.');
    await run(await json(resolve(options['--config'])), options['--out']);
  } else if (command === 'render') await render(options['--out']);
  else await report(options['--out']);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
}
