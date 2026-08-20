# Review 006g: bounded skill document discovery

- Slice: `feat: discover canonical Agent Skill documents`
- Reviewers: independent subagents `/root/review_validator_fs` and `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

Review rejected unbounded `readdir` allocation and accepting both `SKILL.md` and a case-colliding
alias on case-sensitive filesystems. Discovery now streams at most 1,024 immediate entries with
`opendir`, scans the complete bounded set, rejects missing, mis-cased, colliding, symlinked, and
non-file documents, and verifies the root before and after document inspection.

## Verification

The clean cumulative slice passed 196 tests. `skill-document.ts` reached 98.48% statements and
97.43% branches. Tests include deterministic injected directory failures plus real filesystem
entry budgets, case capability detection, canonical spelling, file type, document size, and UTF-8.
