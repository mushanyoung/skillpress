# Review 005e: manifest error hygiene

- Slice: `fix: discard hostile manifest access causes`
- Reviewer: independent subagent `/root/review_manifest_snapshot`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Finding

The manifest snapshot already replaced caller-forged errors with stable top-level diagnostics, but
it retained the value thrown by a hostile getter as the public `ProjectCreationError.cause`.
Callers could therefore inject arbitrary messages, issues, or poison proxies through the cause
chain even though the visible diagnostic was normalized.

## Resolution

- Manifest runtime-input validation never retains values thrown by project, array, or file field
  accessors.
- Normal getters, poison proxies, forged `ProjectCreationError` instances, and replayed prior
  errors all produce a fresh `create.manifest_type` error without a cause property.
- Filesystem and transaction errors remain outside this narrow change and keep their separately
  reviewed error contracts.

## Verification

```text
npm run check
git diff --check
```

The reviewer recreated the patch on the exact pushed base, passed 76 tests plus format, lint,
generated-source, and type checks, and independently probed file and index getters and a revoked
array. A focused error-constructor contract keeps trusted internal causes covered while manifest
input errors discard them; `src/create/errors.ts` has 100% branch coverage. No reproducible blocker
remained.
