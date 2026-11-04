---
name: model-nerf-check
description: Check whether an API endpoint shows degraded model output using repeated GetPlus pelican-on-a-bicycle trials, rendered evidence, and optional trusted-baseline comparison. Use for suspected model nerfing, weaker-model routing, or proxy quality checks. Does not authenticate the upstream model.
---

# Model Nerf Check

Use the bundled runner for fresh API requests, then inspect rendered artifacts.
Treat a quality regression as a signal for investigation, never proof of routing
to a different model. Returned model names and fingerprints are unverified claims.

## Set Up

Resolve paths relative to this SKILL.md, not the user's current directory.
Node.js 22.20+ is required. Read [the protocol](references/protocol.md) before
scoring and [configuration](references/configuration.md) when preparing requests.
The sample config is in `assets/endpoints.example.json`.

Use the endpoint URL, exact model ID, protocol and credential environment variable
specified by the user. Do not guess model IDs or read unrelated credential files.
Prefer a trusted baseline with the same claimed model and request settings.
Credentials stay in environment variables; never put them in command arguments,
config files or reports. Run only endpoints the user authorizes. Explain the
request count before a live run: default three requests per endpoint, no retries.
If credentials or endpoint details are missing, prepare the config and ask only
for the missing values. Do not substitute a different model or endpoint.

## Run and Review

1. Run `node <skill-dir>/scripts/check.mjs run --config <config.json> --out <new-run-dir>`.
   Each trial is independent. Keep every trial, including failures. The fixed
   source prompt is sent verbatim, without skill instructions, conversation
   history, tools, or extra generation guidance. Its instruction not to use
   skills applies to the tested model, not to this evaluation workflow.
2. Capture frames with `node <skill-dir>/scripts/check.mjs render --out <run-dir>`.
   If Playwright is missing, run `npm install --prefix <skill-dir>` and then
   `npx --prefix <skill-dir> playwright install chromium`. Generated HTML is
   untrusted: use the bundled isolated renderer, not the user's normal browser.
3. Open each trial's `frame-*.png` images using an available image-viewing tool.
   Inspect all three phases for wheels, feet/pedals, perspective and pelican
   anatomy. Do not infer correctness from source code or screenshot hashes.
   Record values and concrete frame evidence in `scores.json`; identify the
   reviewer. Keep unseen or ambiguous checks null. Never repair generated HTML
   or generate a replacement and score that instead.
4. Run `node <skill-dir>/scripts/check.mjs report --out <run-dir>`.
   Read `report.md` and explain observed recurring defects, sample counts,
   baseline differences, and limitations. Keep transport and output-limit
   failures separate from visual quality. A successful sample does not prove
   authentic routing; a failed sample does not prove substitution.

If image inspection is unavailable, provide the frames and leave scores null.
For automatic judging requested by the user, use an independently configured
vision-capable judge, disclose its identity and uncertainty, and retain its
evidence. Never silently use the suspected endpoint as its own judge.
