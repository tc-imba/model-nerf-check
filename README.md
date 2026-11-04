# model-nerf-check

A portable skill for Codex and Claude Code that checks API output quality using
the [GetPlus pelican animation test](https://www.getplus.ai/codex/gpt6-astra-jiangzhi).
It preserves the original Chinese prompt, makes independent API calls, captures
animation frames, and records evidence against the article's four structural
checks. An optional baseline helps reveal recurring quality differences.

**This detects observable quality differences, not the identity of the upstream
model.** A low score cannot prove a proxy substituted a weaker model. A high
score cannot prove authenticity. Model labels returned by a proxy are unverified.

## Install

Use Node.js 22.20+ for the runner and `npx skills`:

```sh
npx skills add tc-imba/model-nerf-check --skill model-nerf-check -a codex -a claude-code
```

For Microsoft Agent Package Manager (APM), run from a consuming project:

```sh
apm install tc-imba/model-nerf-check --target codex,claude
```

From a local clone:

```sh
npx skills add ./model-nerf-check --skill model-nerf-check -a codex -a claude-code
```

Or, from inside this repository:

```sh
npx skills add . --skill model-nerf-check -a codex -a claude-code
```

APM also supports a local repository:

```sh
apm install /absolute/path/to/model-nerf-check --target codex,claude
```

These install the same self-contained skill directory, including its scripts,
references and runtime manifest. No npm publishing is needed. Add `-g` to the
installer for user scope.

Invoke `$model-nerf-check` in Codex or `/model-nerf-check` in Claude Code. Supply
the endpoint URL, protocol, exact model ID and API key environment variable name.
The skill runs the benchmark and reviews its own generated screenshots using
the host's image-viewing capability. It does not send screenshots to a separate
paid judge by default. An existing chat's model cannot be authenticated by
having it answer this task; the runner measures the endpoint configured explicitly.

## Run Directly

Copy `skills/model-nerf-check/assets/endpoints.example.json` to
`endpoints.local.json`, replace the placeholder endpoint/model, and remove the
baseline entry if unavailable. Set the named API keys in your environment.
Keep keys out of config files. The default is three requests per endpoint,
without retries. No live API calls occur during installation or tests.

```sh
node skills/model-nerf-check/scripts/check.mjs run --config endpoints.local.json --out runs/check-001
npm ci --prefix skills/model-nerf-check
npx --prefix skills/model-nerf-check playwright install chromium
node skills/model-nerf-check/scripts/check.mjs render --out runs/check-001
```

Inspect all three `frame-*.png` images for every trial. Fill in `scores.json`
with reviewer identity, animation observations, and evidence for each score.
Then generate the report:

```sh
node skills/model-nerf-check/scripts/check.mjs report --out runs/check-001
```

Supported API protocols are OpenAI Responses (`responses`), OpenAI-compatible
Chat Completions (`chat`), and Anthropic Messages (`anthropic`). Each URL must
include its full route, such as `/v1/responses`, `/v1/chat/completions` or
`/v1/messages`. Protocol and reasoning settings are explicit, with no fallback
to another model or protocol. See [configuration](skills/model-nerf-check/references/configuration.md).

Generated HTML is captured in an ephemeral Chromium context inside a sandboxed
opaque-origin iframe with outbound requests blocked. It is never opened in your
normal browser profile. Local browser isolation is defense in depth, not a
security boundary against browser vulnerabilities; use a disposable machine or
container for hostile endpoints. Capturing does not modify the original HTML.

## Evidence

Every run preserves the prompt hash, request bodies, response text, usage,
request IDs, timing, generated HTML, frame hashes, reviews and a Markdown/JSON
report. Only credential environment variable names are configured; authorization
headers are never written. Exact key values are redacted if echoed back. Treat
all remaining provider output as private, and keep runs out of source control.

Score wheels, feet/pedals, perspective and pelican anatomy. Leave unseen checks
unscored. Errors and truncated outputs are reported separately. The report
contains descriptive means and repeated defects, with no automatic accusation
of fraud, model identification, or calibrated severity labels. A baseline is
useful when its model and generation settings match; differences are flagged.
Read the [protocol and limits](skills/model-nerf-check/references/protocol.md).

## Development

```sh
npm test
```

Tests use local mock servers, require no real credentials and make no billable
API calls. Rendering integration tests require the skill's runtime dependencies
and Chromium (the two installation commands above). APM and `npx skills` package
the portable `skills/model-nerf-check` folder; avoid moving runtime resources
outside it. The source prompt is quoted with attribution for reproducibility;
the original article's example animations and other content are not bundled.
