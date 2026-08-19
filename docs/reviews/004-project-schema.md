# Review 004: versioned project schema

- Slice: `feat: validate the versioned project schema`
- Reviewer: independent subagent `/root/review_config_schema`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## First review

The first pass found two security blockers:

1. A one-mebibyte byte limit did not bound YAML structure expansion. A deeply nested flow sequence
   could consume hundreds of mebibytes while `parseAllDocuments` built its syntax tree.
2. The loader rejected only a final symbolic link and did not compare the inspected file identity
   with the opened file, leaving intermediate-link and check/open replacement gaps.

## Resolution

- Reduced the configuration limit to 64 KiB and enforce it before opening, after opening, and while
  reading.
- Added a streaming lexical budget before AST construction: at most 8,192 tokens, 32 flow levels,
  and 64 spaces of block indentation.
- Inspect every path component with `lstat` and reject intermediate, final, and directory-default
  symbolic links.
- Compare `dev` and `ino` after `open`/`fstat`, with a deterministic injected swap regression test.
- Retained fatal UTF-8 decoding, duplicate-key, multi-document, alias, schema, and regular-file
  checks with stable issue codes.

## Verification

```text
npm ci
npm run check
npm audit
npm pack --dry-run --json
```

Results: 33 tests passed; statements were 95.04% and branches were 92.53%; dependency audit
reported no vulnerabilities; generated types matched the authoritative JSON Schema; and the
package contained both compiled code and the schema. The reviewer also checked an exactly 64 KiB
deep-flow input, all three symbolic-link positions, and a regular-file identity swap before
returning PASS on Node.js 26.
