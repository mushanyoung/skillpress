# Review 009m: bounded resource-tree semantic comparison

- Slice: `feat: compare captured resource-tree semantics`
- Review: independent API, bounded-work, and release verification
- Date: 2026-08-20
- Frozen base: `807d8873537471b67150df1ffb39be063e154696`
- Final result: PASS

## Scope and guarantees

The new internal `resource-tree-comparison` module exports
`compareResourceTreeCaptureSemantics(left, right)`. It returns only the primitive result `equal`,
`different`, or `invalid`. It performs no filesystem, session, network, capture, or currentness
operation, retains no input, and returns no canonical object. The helper is not exported from the
package root or from an importable package subpath.

The comparator is deliberately semantic-only. It takes an instantaneous projection of the
required own data fields from current-realm ordinary objects and dense arrays. Records must have
the current-realm `Object.prototype`; arrays must have the current-realm `Array.prototype`, an own
data `length` within the local bound, and an own data value at every required numeric slot. A
required missing, inherited, or accessor field is invalid, and no required accessor is invoked.
The module-initialization-captured `util.types.isProxy` check runs before descriptor or prototype
inspection, so ordinary and revoked proxies are rejected without triggering their traps.

Extra own or inherited fields, symbols, descriptor flags, mutability, frozen state, and a present,
missing, data, or accessor `then` property are intentionally outside the projection. Their values
do not affect equality, and extra accessors are not read. Consequently, a mutable current-realm
structured clone can compare equal to a frozen capture result. This is intentional: `equal` does
not establish a genuine capture, provenance, freshness, authority, alias identity, or continued
stability after the synchronous call returns. Foreign-realm structural objects have different
prototypes and are invalid.

This contract replaced an earlier exact-key and deep-freeze proposal during review. Enumerating
all keys or asking whether an arbitrary object is frozen can perform attacker-sized reflection
before a local budget is applied. The final implementation never enumerates caller keys. It reads
only the fixed schema fields, checks an array's own length against a local cap before reading
slots, and uses numeric loops rather than iterators. Because the operation is synchronous and
invokes no caller callback, the required-field projection remains bounded without treating input
shape as authority.

Both operands are fully projected and validated before token comparison. Thus any malformed
field in either operand returns `invalid`, even when an earlier valid field differs. Two valid
projections are emitted into separate private primitive-token streams in fixed schema order;
length or token differences return `different`, and complete identity returns `equal`. The token
streams are implementation-local and never escape.

## Compared semantics and limits

The projection covers all seven root and entry layout fields, all seven metadata fields, entry
roles, and retained directory indexes. Metadata is re-snapshotted through the captured
`snapshotFileMetadata` producer, preserving all bigint scalars while checking that `kind` agrees
with the mode bits. Root metadata must be a directory; document and resource-file entries must be
files; directory entries must carry directory metadata and a name index.

For every directory index, comparison includes all five entry fields, NFC groups, fixed-fold
groups, and all three finding variants (`non_nfc`, `nfc_collision`, and
`fixed_fold_collision`), including every nested array length, value, and order. Array order is
semantic throughout. The flattened entry ordinal must match `entryIndex`; a non-null parent index
must refer to a prior ordinal; depth is limited to 1 through 64; stored UTF-8 byte lengths for exact
names and relative paths are recomputed with the captured buffer capability. The root's fixed
zero-valued layout uses captured `Object.is`, so negative zero is rejected.

The local structural bounds are 8,192 flattened entries, 1,024 entries per name index, 2,048
findings per index, and 8 MiB for the aggregate stored relative-path byte lengths. Index-entry
totals must equal the flattened entry count. Each operand has an independent 1,048,576-item work
budget and 64 Mi UTF-16-code-unit string budget. A record charges its projection node plus required
fields, an array charges its node plus dense slots after its local length check, and every emitted
primitive charges one more work item. Every string occurrence is counted at its original UTF-16
length without deduplication, before any UTF-8 byte scan.

An independent bounds audit derived a maximum of 913,448 work items and 48,418,825 UTF-16 code
units for a producer-valid maximum capture, below both local budgets. This bound uses the producer
invariants that directory-index entry totals equal the tree entries and that group and finding
lists are derived partitions. Hostile structural input may instead reach a local budget and be
reported as `invalid`; the comparator does not reinterpret that rejection as an upstream capture
validity result.

Module initialization captures proxy detection, descriptor and prototype inspection, array and
number checks, `Object.is`, token-slot definition, buffer byte length, and metadata snapshotting.
Post-import replacement of those live bindings does not alter comparison. Token append uses the
captured own-slot definition capability, and neither input nor output iteration depends on
`Array.prototype[Symbol.iterator]` or an inherited numeric slot.

## Independent review

The API reviewer reconstructed the frozen candidate in a fresh worktree, reported PASS with zero
blockers, and ran two additional private cases distinct from the authored suite. The first compared
consecutive genuine captures as equal, then modified a resource and observed a fresh capture as
different. The second independently reached the 64-Mi occurrence cap with repeated 1,024-code-unit
strings, reached the work-item cap with a large short-string structure, and confirmed that 20,000
extra keys plus an ignored getter still compared equal with zero getter calls. Both private cases
passed. The fresh complete repository gate, which did not add those cases to its count, passed 40
test files and 441 tests.

The authored one-file, five-test focused selection passed independently on Node.js 22.23.2,
24.19.0, and 26.7.0. The two private cases were run separately and are not attributed to that
cross-version matrix.

A separate adversarial static inspection reported zero implementation blockers. Its independent
bounded-work child audit established the 913,448-work-item and 48,418,825-code-unit maxima recorded
above. This record does not present the parent review turn, which did not produce a completed final
verdict, as an independent runtime PASS.

A neutral fresh release replay separately passed the authored five focused tests and the complete
40-file, 441-test gate. It reported zero production dependency vulnerabilities, completed a pack
dry run, confirmed that the package root did not expose the comparator, and compared equal at the
8,192-entry maximum with 255-byte exact names. The maximum-size probe was not added to the complete
gate's 40-file, 441-test count. This replay is release evidence, not an additional private test
suite folded into the API reviewer's two cases.

The API review also reported zero production dependency vulnerabilities. A fresh pack operation
completed prepack and build successfully, producing 167 files, a 117,096-byte tarball, and 593,899
unpacked bytes. Consumer checks confirmed the comparator's absence from the package-root runtime
and declaration surfaces, while importing its internal subpath remained blocked by the package
export boundary.

## Verification

The frozen candidate is based on
`807d8873537471b67150df1ffb39be063e154696`. Its implementation SHA-256 is
`21be369f678a11ab5e4015d3b8862ab2d2e4d9320d2ba9b66eee8a8fa9492205`, and its targeted-test
SHA-256 is `d7bfe8326f0115bf055bfcc8d4d7261f6a32b1907256f61173e8033b13a63eb6`.

The authored focused file passes all five tests. The comparison module reaches 93.54% statements,
93.36% branches, 100% functions, and 98.81% lines. Those tests cover actual capture equality,
current-realm mutable and frozen clones, every retained scalar and nested sequence, invalid-over-
different priority, proxy and accessor non-interaction, numeric and byte boundaries, the exact
8-MiB aggregate path boundary and its one-byte overflow, captured-intrinsic pollution, and the
internal export boundary. Formatting, lint, generated-file freshness, type checking, build,
coverage thresholds, and `git diff --check` pass in the fresh complete gate.
