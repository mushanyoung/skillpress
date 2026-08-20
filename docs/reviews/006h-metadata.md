# Review 006h: supplemental Agent Skill metadata

- Slice: `feat: validate supplemental Agent Skill metadata`
- Reviewers: independent subagents `/root/review_validator_yaml` and `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

The review found that `allowed-tools` was checked only for non-emptiness, allowing tabs and
newlines despite the specification's space-delimited string contract. It now requires non-empty
tokens separated by one ASCII space. License, compatibility, and metadata types and lengths are
validated; metadata uses a frozen null-prototype string map, including safe `__proto__` keys.

Missing licenses, empty bodies, bodies over the recommended line count, and experimental
`allowed-tools` portability are warnings. Target-only Anthropic restrictions remain scoped
warnings here and will become fatal in the corresponding target eligibility gate.

## Verification

The clean cumulative slice passed 200 tests. Focused cases cover optional-field types, boundaries,
tool delimiters, metadata key/value shapes, prototype safety, and body/license warnings.
