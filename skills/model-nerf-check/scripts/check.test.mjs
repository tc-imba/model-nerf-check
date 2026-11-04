import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, extractHtml, parseResponse, validateConfig, PROMPT } from './check.mjs';

const base = {
  id: 'candidate', role: 'candidate', url: 'https://proxy.example.test/v1/responses',
  model: 'model-under-test', keyEnv: 'KEY', parameters: {}, protocol: 'responses',
};

test('uses the fixed source prompt and prevents payload state', () => {
  const request = buildRequest({ ...base, parameters: { max_output_tokens: 1234, store: true } });
  assert.equal(request.input, PROMPT);
  assert.equal(request.store, false);
  assert.equal(request.stream, false);
  assert.equal(request.model, base.model);
  assert.equal(request.max_output_tokens, 1234);
});

test('builds all supported protocol payloads', () => {
  const chat = buildRequest({ ...base, protocol: 'chat', parameters: { temperature: 0.2 } });
  assert.equal(chat.messages[0].content, PROMPT);
  assert.equal(chat.max_completion_tokens, 16000);
  const anthropic = buildRequest({ ...base, protocol: 'anthropic', parameters: { max_tokens: 500 } });
  assert.equal(anthropic.messages[0].content, PROMPT);
  assert.equal(anthropic.max_tokens, 500);
});

test('parses complete protocol responses and rejects incomplete text', () => {
  assert.equal(parseResponse('responses', { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }]}).complete, true);
  assert.equal(parseResponse('chat', { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]}).text, 'ok');
  assert.equal(parseResponse('anthropic', { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }).complete, true);
});

test('extracts exactly one HTML document', () => {
  assert.equal(extractHtml('```html\n<!doctype html><html><body>ok</body></html>\n```'), '<!doctype html><html><body>ok</body></html>');
  assert.equal(extractHtml('not html'), null);
  assert.equal(extractHtml('<html>a</html>\n<html>b</html>'), null);
});

test('validates endpoint safety and credentials', () => {
  const valid = validateConfig({ endpoints: [base] }, { KEY: 'secret' });
  assert.equal(valid.runs, 3);
  assert.throws(() => validateConfig({ endpoints: [{ ...base, url: 'http://example.com/v1/responses' }] }, { KEY: 'secret' }), /HTTPS/);
  assert.throws(() => validateConfig({ endpoints: [base] }, {}), /KEY/);
  assert.throws(() => validateConfig({ endpoints: [{ ...base, parameters: { tools: [] } }] }, { KEY: 'secret' }), /Unsupported/);
  const internal = { ...base, url: 'http://10.0.0.10/v1/responses', allowInsecureHttp: true };
  assert.equal(validateConfig({ endpoints: [internal] }, { KEY: 'secret' }).endpoints[0].allowInsecureHttp, true);
  assert.throws(() => validateConfig({ endpoints: [{ ...internal, allowInsecureHttp: 'true' }] }, { KEY: 'secret' }), /boolean/);
  assert.throws(() => validateConfig({ endpoints: [{ ...internal, url: 'ftp://10.0.0.10/v1/responses' }] }, { KEY: 'secret' }), /HTTPS/);
});
