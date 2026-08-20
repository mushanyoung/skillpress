# Review 006e: canonical skill roots

- Slice: `feat: inspect canonical Agent Skill roots`
- Reviewers: independent subagents `/root/review_validator_fs` and `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

Review showed that validating only the final root inode allowed an ancestor directory to be
replaced by a symlink to the same tree. It also showed that caller-provided casing could hide a
directory-name mismatch on case-insensitive filesystems and that `resolve()` errors could escape
when the current directory disappeared.

Root inspection now bounds paths to 256 resolved components, snapshots every component with
BigInt filesystem identities, rejects symlinks and non-directories, obtains canonical on-disk
spelling, and revalidates the chain. Native errors become stable diagnostics without causes or
paths.

## Verification

The clean cumulative slice passed 178 tests. Direct and injected tests cover missing, non-directory,
symlinked, overly deep, renamed, canonicalized, poisoned-error, and disappeared-cwd cases.
