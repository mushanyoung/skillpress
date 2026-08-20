# Review 006d: strict Agent Skills frontmatter

- Slice: `feat: parse strict Agent Skills frontmatter`
- Reviewers: independent subagents `/root/review_validator_yaml` and `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

Initial review rejected two behaviors: YAML escapes could introduce NUL, ESC, C1, noncharacters,
or unpaired surrogates after the raw-source scan, and syntax diagnostics lost their real location
when `prettyErrors` was disabled. Both were fixed at the decoded AST boundary and with
`YAMLError.pos` plus `LineCounter`.

The parser uses YAML 1.2 core without `toJS`, rejects aliases, anchors, explicit tags, merge keys,
duplicates, unknown fields, non-string shapes, and excessive byte/token/node/indent/flow
complexity. Messages never reflect untrusted YAML text.

## Verification

The clean cumulative slice passed 173 tests. The YAML reviewer checked every forbidden C0/C1,
all 66 Unicode noncharacters, all 2,048 individual surrogate code units, strict YAML hostile
shapes, CRLF locations, 20,000 fuzz documents, diagnostic bounds, and a clean package install.
