# Review 005d: owned-tree cleanup primitives

- Slice: `feat: clean only journaled filesystem identities`
- Reviewer: independent subagent `/root/review_owned_tree`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Review focus

This smaller follow-on commit was split from the reviewed owned-tree diff so deletion and marker
recovery remain independently auditable. The reviewer attacked missing, replaced, symbolic-link,
nonempty, out-of-journal, and callback-race cases.

## Resolution

- Delete files and then directories only when current bigint `dev`/`ino`, type, and non-symlink
  state match the journal.
- Treat a missing path as uncertain rather than assuming another actor performed safe cleanup.
- Stop target cleanup before marker removal whenever a body identity changed or unknown data keeps
  a directory nonempty.
- For the final claimed root, require either an empty unmarked root or the exact single journaled
  marker before removal.
- If the marker was removed but the root cannot be removed, restore a fresh private marker only
  while the root identity still matches and never overwrite a concurrently supplied marker.

## Verification

```text
npm run check
git diff --check
```

The combined implementation passed 134 tests before this review-driven split. The exact cleanup
commit is verified again in a clean worktree before push. The reviewer returned PASS while noting
the documented portable-Node same-account TOCTOU boundary and deferred crash-durable `fsync` work.
