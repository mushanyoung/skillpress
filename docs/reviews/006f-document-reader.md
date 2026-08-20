# Review 006f: bounded skill document reader

- Slice: `feat: read inspected Agent Skill documents safely`
- Reviewers: independent subagents `/root/review_validator_fs` and `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

The first filesystem review replaced an inspected regular file with a FIFO and reproduced a
blocking POSIX open. It also reproduced ancestor replacement and final-file identity races.

The reader now uses supported `O_NOFOLLOW` and `O_NONBLOCK` flags, a non-mutating Windows fallback,
BigInt identity/size/time snapshots, a limit-plus-one streaming read, fatal UTF-8 decoding, and
root-chain checks before and after the read. Invalid handles, read results, close failures, and
native errors are normalized. Same-account concurrent mutation remains an explicit portable-Node
trust boundary.

## Verification

The clean cumulative slice passed 186 tests. `skill-document-read.ts` exceeded 95% statements and
98% branches; tests cover identity swaps, symlink fallback, nonblocking flags, exact byte limits,
growth, invalid handles, invalid UTF-8, and close failures.
