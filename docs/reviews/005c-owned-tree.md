# Review 005c: owned-tree verification primitives

- Slice: `feat: verify owned filesystem trees`
- Reviewer: independent subagent `/root/review_owned_tree`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## First review

The independent review found four exactness and portability blockers:

1. Verification checked journal entries against expected files but did not require every expected
   file to have an entry, so a missing file could disappear from both disk and the journal.
2. An expected file path could be satisfied by a directory journal entry.
3. Without `O_NOFOLLOW` on Windows, file finalization could follow a same-inode replacement link
   and apply `chmod` before the later path check rejected it.
4. Number-valued filesystem identifiers can lose precision for 64-bit `dev`/`ino`, allowing two
   distinct identities above JavaScript's safe-integer limit to compare equal.

The review also asked the primitive to reject duplicate, orphaned, and out-of-root journal paths
before touching them.

## Resolution

- Require a bijection between expected files and owned regular-file entries, including the exact
  root directory and a fully journaled parent chain.
- Reject duplicate and out-of-root entries before inventory, content reads, or mode changes. The
  follow-on cleanup primitive consumes only the writer's internal journal.
- Record and compare `dev` and `ino` using Node's `BigIntStats` for both path and open-handle checks.
- On POSIX, open with `O_NOFOLLOW`, verify handle identity/type/size, read at most the expected bytes
  plus one, recheck identity, verify SHA-256, and change mode through the verified handle.
- Where no-follow open flags are unavailable, reject stable symlinks before open, gate reads on
  handle identity, never change mode, and require a final non-symlink path identity check.
- Inventory every directory exactly and expose only bigint-identified entries to the separately
  reviewed cleanup transaction.

## Verification

```text
npm run check
git diff --check
```

The combined pre-split tree passed 134 accumulated tests; the exact focused commit is verified in a
clean worktree before push. The reviewer returned PASS on identity, containment, inventory,
digest, no-follow, and fallback behavior. Actual Windows CI and crash-durable `fsync` remain later
slices; same-account malicious filesystem races remain an explicit portable-Node trust boundary.
