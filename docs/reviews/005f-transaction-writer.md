# Review 005f: transaction writer

- Slice: `feat: write rendered projects without clobbering destinations`
- Reviewers: independent subagents `/root/review_transactional_create` and
  `/root/review_writer_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Review findings

Successive hostile reviews found unsafe symlink reads, mutable manifest references, unbounded file
counts and paths, intermediate-directory races, missing exact-inventory checks, replace-on-rename
semantics, Windows no-follow portability gaps, ambiguous Unicode paths, late options access, and
caller-controlled errors surviving in public cause chains. The manifest, identity, and cleanup
primitives were split into earlier reviewed commits before this orchestration slice was frozen.

## Resolution

- Snapshot bounded project data and runtime options synchronously before the first filesystem
  operation; discard untrusted callback and manifest-access causes.
- Reject blank, invalid UTF-8, control, default-ignorable, line-separator, and Unicode noncharacter
  output paths before filesystem access.
- Populate and verify a private same-parent stage, recheck the parent identity, and atomically
  claim only an absent destination with `mkdir`; no rename operation can replace an existing path.
- Publish through an identity journal and incomplete marker, require exact recursive inventory and
  SHA-256 content, and remove only entries whose bigint filesystem identity and type still match.
- Preserve the marker and any unknown or replaced data whenever rollback cannot prove ownership.
- Use descriptor-bound no-follow verification and mode changes on POSIX. Where Node lacks those
  flags, verify without mutating modes and recheck the final non-symlink path identity.
- Return only the immutable snapshotted paths and digests that were verified on disk.

## Verification

```text
npm run check
npm audit
npm pack --dry-run --json
git diff --check
```

The final reviewed writer and test files have SHA-256 values
`39c1676fbc218921c395f75b28c06804f4fc8903c1a99f373662bef96ee79d9f` and
`4fc44220178356247100006b3c9911d5265c9f5f1a140d301afb0e8424cb0dfd`. Reviewers passed 20-way
concurrency, replacement and symlink races, hostile options/callbacks/thenables, the Windows
capability fallback, digest-to-disk receipts, package installation, and the accumulated 140-test
candidate. Crash-durable `fsync`, native Windows CI, and malicious concurrent processes under the
same OS account remain explicit later work or documented trust boundaries.
