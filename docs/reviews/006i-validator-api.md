# Review 006i: public Agent Skill validator

- Slice: `feat: expose the Agent Skill validator`
- Reviewers: independent subagents `/root/review_validator_api`, `/root/review_validator_fs`, and
  `/root/review_validator_yaml`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Review result

The public orchestrator validates API inputs before filesystem access, requires portable ASCII
names that match both the canonical directory and optional project name, applies Agent Skills
description limits, freezes successful metadata, and distinguishes generic errors from portable
or target-specific warnings. It reads instructions but never executes them or follows Markdown
references; reference-graph validation is the next reviewed slice.

## Verification

The independently reconstructed 006a–006i sequence passed every clean cumulative gate. The final
candidate passed 208 tests with 97.11% statements and 95.62% branches; all deterministic source
files exceeded the per-file 90% thresholds. Node 22, 24, and 26 checks, `npm audit`,
`npm pack`, clean consumer ESM and TypeScript imports, a real valid/invalid skill validation, and
the installed `.bin` smoke all passed. Random YAML and cross-platform path probes produced no
unhandled errors or diagnostic overflow.
