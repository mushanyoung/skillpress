# Review 006c: Agent Skill document envelope

- Slice: `feat: parse bounded Agent Skill document envelopes`
- Reviewers: independent subagents `/root/review_validator_yaml` and `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Review result

The parser requires an exact opening and closing `---` line at the document start, supports LF,
CRLF, and CR without rewriting content, rejects BOMs and forbidden source controls, and enforces a
64 KiB UTF-8 frontmatter budget before YAML parsing. It neither guesses a delimiter nor scans the
Markdown body as YAML.

## Verification

The independently reconstructed cumulative slice passed 164 tests. Boundary tests cover exact and
one-byte-over limits, multibyte UTF-8, malformed delimiters, source locations, and deterministic
diagnostics.
