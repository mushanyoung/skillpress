# Review 007a: bounded CommonMark analysis

- Slice: `feat: analyze bounded CommonMark`
- Reviewers: independent subagents `/root/review_validator_yaml` and
  `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

Review first rejected a post-parse-only node limit after a 512 KiB link bomb made the parser build
more than 150,000 nodes and consume roughly 786 MiB. A bounded pre-parse syntax scan now runs
before CommonMark, while the post-parse node cap remains as a second layer. Review also required
reference-style targets to retain their first definition, occurrence form, reference type, and
both usage and destination locations. Heading summaries now omit raw HTML and preserve image alt
text.

The analyzer intentionally recognizes CommonMark link, image, and definition nodes only. It does
not claim that raw HTML, code blocks, inline code, or bare resource paths are file references;
node-aware bundled-resource recognition is a later reviewed slice.

## Verification

The independently reconstructed slice passed 223 tests with no skips. The new analyzer reached
97.5% statements, 96.15% branches, 100% functions, and 98.11% lines. Exact and plus-one source,
UTF-8 byte, syntax-marker, node, target, and definition boundaries passed. The hostile link bomb
was rejected before parser invocation, production audit found no vulnerabilities, package dry-run
passed, and compiled imports were exercised on Node.js 22 and 26.
