# Protocol and Interpretation

Source: https://www.getplus.ai/codex/gpt6-astra-jiangzhi
Retrieved November 4, 2026. The source describes an informal quality test, not
an official model-authentication method. Its four examples do not establish
the cause of quality variation. This repository does not redistribute their HTML.

The runner preserves this source prompt verbatim (UTF-8, no appended guidance):

> 创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试，只靠你自己完成，不要使用任何skill，不要依赖我本地的AGENTS.md

It asks for a self-contained HTML SVG animation of a pelican riding a bicycle,
without tests, skills, or local AGENTS.md. Translating or elaborating the prompt
changes the test. There is no tool execution in the generation request.

Review structural relationships, not decoration or aesthetics:

| Key | Pass: 1 | Partial: 0.5 | Fail: 0 |
| --- | --- | --- | --- |
| wheels | Two complete, visible bicycle wheels | A wheel is incomplete | Wheel(s) absent |
| pedals | Feet remain on moving pedals, with coherent leg joints | Contact is intermittent or ambiguous in some frames | Detached feet/legs or missing pedals |
| perspective | Bird and bicycle share coherent perspective | A limited inconsistency | Conflicting orientations break the riding pose |
| pelican | Distinct long bill and throat pouch | Generic long bill, weak pouch | Not recognizable as a pelican |

Use null for a check that cannot be evaluated. Evidence must mention frame
filenames and what they show. The 0/0.5/1 scale and aggregate statistics are this
repository's evaluation convention, not calibrated source tiers. Do not assign
the article's severity labels automatically. Frames are observations at capture
times, not a proof of continuity across an entire animation. Also record whether
the frames show animation as true, false, or null, separately from the four items.

Use at least three independent trials per endpoint when feasible. Never select
only the best output; preserve first responses and do not retry automatically.
The runner alternates endpoint order between rounds to reduce time-order bias.
Three trials are a small descriptive sample; increase only within the user's
request budget. Review identities may bias scoring: where possible, review
anonymous copies before looking at endpoint labels. Do not call the default
workflow blinded. This is a single known task, vulnerable to task-specific tuning.

The report gives means only for fully reviewed, complete trials and lists
incomplete or errored trials separately. Repeated defects mean a check scored
below 1 in at least two reviewed trials. Comparisons need matching generation
settings; protocol differences, reasoning budgets, sampling settings, rate
limits, filters, context, temporal changes and evaluator bias can confound them.
An official direct API is a useful baseline, but the tool does not attest that
an endpoint is official. No statistical significance or routing identity is
claimed. Provider-side attestation or routing records would be needed for that.
