# Review 005b: rendered manifest snapshot

- Slice: `feat: guard rendered project manifests before filesystem access`
- Reviewer: independent subagent `/root/review_manifest_snapshot`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## First review

The adversarial passes found six ways a nominally typed manifest could evade a naive copy:

1. An array proxy could supply an unbounded custom iterator despite a small reported length.
2. A case-variant incomplete marker could alias the transaction marker on common filesystems.
3. File/directory prefix conflicts and parent-directory case aliases could produce a tree that
   cannot be materialized portably.
4. A case-insensitive canonical-file check could accept `skill.md` instead of exact `SKILL.md`.
5. Throwing proxies could escape error normalization through a hostile `getPrototypeOf` trap.
6. Caller-created or previously returned errors could be forged, mutated, and replayed through a
   getter if catches trusted `instanceof` or persistent branding.

## Resolution

- Capture a validated numeric array length and read at most 1,024 indexed entries; custom
  iterators are never invoked and sparse entries are rejected.
- Snapshot and freeze every path/content/digest triple before any filesystem await.
- Enforce portable ASCII paths, exact canonical `SKILL.md`, case-folded marker reservation,
  Windows device-name/trailing-dot rejection, depth/component/path/aggregate budgets, and a
  case-folded path tree that rejects duplicate, parent-alias, and file/directory collisions.
- Bound total content at 2 MiB, require lossless UTF-8 encoding, and recompute every SHA-256 digest.
- Put try/catch only around hostile project, file, length, and index reads. Deterministic validation
  errors are thrown outside those scopes, so forged, proxy-thrown, and replayed errors are always
  replaced with stable diagnostics.
- Return deterministically sorted files, directory order, and expected byte/digest metadata for
  the transaction writer.

## Verification

```text
npm run check
git diff --check
```

Results before commit: 112 accumulated tests passed; statements were 95.91% and branches 93.43%;
the manifest module was 98.09% statements and 98.38% branches. The reviewer separately probed the
exact 1,024-file, 2 MiB-content, 512-byte-path, and 16-level boundaries and returned PASS. A clean
worktree verification of the focused commit is recorded in its commit/push handoff.
