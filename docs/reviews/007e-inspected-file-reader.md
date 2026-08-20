# Review 007e: bounded inspected file reader

- Slice: `refactor: generalize bounded inspected file reads`
- Reviewers: independent subagents `/root/review_validator_fs` and `/root/review_file_reader_api`
- Author: subagent `/root/implement_resource_reader`, finalized by root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

The first candidate accepted arbitrary numeric capability flags. Review demonstrated that injecting
`O_TRUNC` could reach a real read-only open and truncate the inspected file. The final API accepts
only boolean capabilities and obtains every actual flag from Node's own platform constants. A
numeric `O_TRUNC`, non-finite number, fraction, or oversized integer now selects the safe no-follow
fallback and never enters the open bitmask.

Review also found that mutable path, metadata, IO, and root objects could drift after the first
await. The generic reader now copies and validates every retained scalar and IO function before any
asynchronous callback. The SKILL.md adapter captures one authoritative root at entry. On the success
path the descriptor closes before the final pathname and context checks, leaving no additional
await after the linearization checks.

## Verification

Two independently reconstructed clean-state candidates passed all 279 tests with 97.49% statement
and 96.23% branch coverage. The filesystem review repeated the suite on Node 22.20, 24.9, and 26.7.
The API review additionally passed production dependency audit, package dry-run, real package
installation, CLI smoke tests, root-export comparison, and TypeScript exhaustive-union checks.

Hostile probes covered real `O_TRUNC`, FIFO and symlink replacement, capability-disabled fallback,
inode/mode/kind changes, mutable inputs across awaits, non-boolean verifiers, poisoned adapters,
close-time replacement, exact and limit-plus-one byte budgets, BOM retention, and a multibyte UTF-8
sequence split across the 64 KiB read boundary. Existing SKILL.md error codes and messages remain
byte-for-byte compatible.
