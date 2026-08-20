# Review 007d: immutable inspection context

- Slice: `refactor: retain immutable skill inspection context`
- Reviewer: independent subagent `/root/review_validator_fs`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

The first candidate froze Node `BigIntStats` objects directly. Independent review reproduced a
cross-version defect: Node lazily materializes its Date properties, so `atime`, `mtime`, `ctime`,
and `birthtime` threw after the object became non-extensible. The final implementation copies only
the authoritative scalar fields and precomputed file kind into a frozen internal snapshot. Raw
filesystem objects remain unfrozen and are never retained in the validation context.

The loaded skill document now retains one frozen `DocumentInspection`, which contains the single
authoritative root inspection and document snapshot. Later graph traversal can revalidate that
context instead of rebuilding it from a caller-controlled path. Public validation reports and
package-root exports remain unchanged.

## Verification

An independently reconstructed clean-state slice passed all 244 tests on Node 22.20, 24.9, and
26.7, with 97.33% statement and 95.95% branch coverage. Review verified all four lazy Date getters,
hostile metadata getters, contradictory runtime types, mode and kind changes, root and document
identity swaps, ancestor replacement, the no-follow capability fallback, full hierarchy freezing,
and absence of inspection paths or BigInt values from public reports.
