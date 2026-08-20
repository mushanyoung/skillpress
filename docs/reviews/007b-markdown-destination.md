# Review 007b: portable Markdown destinations

- Slice: `feat: classify portable Markdown destinations`
- Reviewers: independent subagents `/root/review_validator_fs`,
  `/root/review_validator_yaml`, and `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

Review prevented local-path NFC and backslash rules from rejecting inert fragments, same-document
queries, and external URIs. It also found that a runtime Unicode case-fold key changed between
Node.js releases as their Unicode tables evolved; the key was removed, and case-collision analysis
is reserved for a later fixed-table filesystem slice. Windows DOS device spellings used as URI
schemes are rejected, and protocol-relative whitespace has its own stable error reason.

The classifier deliberately accepts safe percent-encoded spaces and UTF-8, decodes the local path
exactly once, and rejects encoded separators, delimiters, traversal, residual percent signs, and
non-portable components. Unknown non-dangerous URI schemes are inert external targets and are
never opened or fetched. Literal local queries and encoded `#`, `?`, and `:` remain a documented
SkillPress canonical-path policy rather than an RFC validity claim.

## Verification

Independent snapshots passed 234 tests with no skips. The changed production files had 100%
statements, branches, functions, and lines coverage; overall coverage was 97.31% statements and
95.92% branches. Review exercised Node.js 22, 24, and 26, all Unicode scalar values, 100,000 to
200,000 deterministic hostile inputs, exact byte/component/depth limits, CommonMark decoding,
Windows drive/UNC/device/ADS aliases, and package API isolation. Production audit found no
vulnerabilities.
