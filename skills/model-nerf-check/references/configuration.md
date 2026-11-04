# Configuration

Copy `assets/endpoints.example.json` to a working config. It contains placeholders
that must be replaced; remove the optional baseline if unavailable.

Each endpoint needs a unique safe `id`, `role` (`candidate` or `baseline`),
`protocol` (`responses`, `chat`, or `anthropic`), full `url`, exact `model`, and
`keyEnv` (environment variable name). The URL is the complete API route, not
just a base URL. HTTPS is the default; loopback mock servers may use HTTP.
For a trusted internal HTTP endpoint, set `allowInsecureHttp: true` on that
endpoint explicitly. This sends the configured key over unencrypted HTTP.
The opt-in is preserved in the run manifest. URLs must
not embed credentials or queries. Redirects are rejected to avoid forwarding
credentials to another host. No endpoint or environment is autodetected.

`runs` defaults to 3, allowed range 1-20. `timeoutMs` defaults to 180000,
maximum 600000. `parameters` adds protocol-specific generation settings. The
default output budget is 16000 tokens; reasoning models can use some of this
budget internally. Set a suitable budget explicitly. Do not silently alter it
after a poor result: start a new run and keep the earlier artifacts.

For Responses, use `max_output_tokens` and optional `reasoning`. For Chat
Completions, use `max_completion_tokens` (or explicitly use `max_tokens` for a
provider requiring it) and supported `reasoning_effort`. For Anthropic Messages,
use `max_tokens` and optional supported `thinking`. The runner supplies
`anthropic-version: 2023-06-01` and x-api-key authentication for Messages;
the other protocols use Bearer authentication. Unsupported settings fail
visibly; the runner never retries with a different payload.

Payload ownership is fixed: parameters cannot override model, messages, input,
instructions, system, tools, streaming, or conversation state. The runner sends
non-streaming, stateless requests and sets `store: false` for Responses.

From PowerShell, set a key without putting its value in shell history:

```powershell
$secret = Read-Host 'Candidate API key' -AsSecureString
$env:CANDIDATE_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
node <skill-dir>/scripts/check.mjs run --config endpoints.local.json --out runs/check-001
```

Reports contain endpoint URLs, model labels, usage, settings, raw returned
content and request IDs, but no authorization headers. Exact configured key
values are redacted if echoed by the server. Treat artifacts as private;
arbitrary provider-returned content can still contain sensitive information.

Review `scores.json` after rendering. Fill in `reviewer`, `animation`, and each
check's `value` and `evidence`. Do not change trial IDs. `report` rejects invalid
scores, missing evidence and reviews without frames.
