# Review 009e: mode-based filesystem metadata snapshots

- Slice: `refactor: centralize filesystem metadata snapshots`
- Review: two independent runtime, compatibility, and package-boundary reviews
- Date: 2026-08-20
- Frozen base: `2388b65a426c2fce6306c25213b4c7486badf47d`
- Final result: PASS

## Scope and guarantees

The central metadata copier now derives `directory`, `file`, `symbolic-link`, and `other` solely
from captured `S_IFMT`, `S_IFDIR`, `S_IFREG`, and `S_IFLNK` mode bits. It never reads or invokes
the mutable `Stats.isDirectory`, `Stats.isFile`, or `Stats.isSymbolicLink` methods. The six retained
fields remain exact bigint values, so device and inode identities above JavaScript's safe integer
range are never rounded.

Runtime metadata is accepted only when `dev`, `ino`, `mode`, `size`, `mtimeNs`, and `ctimeNs` are
own data properties. Missing or inherited fields, accessors, malformed values, and proxy descriptor
failures collapse to one fixed `TypeError` without a `cause` or reflected input. If a caller passes
an already-structured snapshot with an own `kind` field, that field must agree with the mode-derived
kind. A raw Node `BigIntStats` object has no `kind` field and remains valid.

All property-descriptor, mode-constant, error-constructor, and freeze capabilities are captured at
module initialization. The copied record is frozen without freezing the source `BigIntStats`, so
Node's lazy `atime`, `mtime`, `ctime`, and `birthtime` Date accessors continue to work normally.

The bounded directory reader now delegates both expected-directory copies and live `lstat`
responses to this central implementation, and delegates complete equality to the shared snapshot
comparator. An expected `InspectedDirectory` remains stricter than a raw `lstat` result: its
metadata must contain an own data `kind: "directory"`. Missing, inherited, or accessor-backed kind
values are rejected before context or filesystem IO, while ordinary raw `BigIntStats` values need
no synthetic kind field. The refactor removes the reader's duplicate mode parser without changing
its error ordering, valid-input behavior, or the package's public API.

## Independent review

The first review reproduced and drove closure of three structural-boundary defects before the
final PASS. An inherited `Object.prototype.kind` had initially been treated as a declared kind; a
directory inspection without its required kind had briefly become acceptable; and missing bigint
fields could initially be supplied through `Object.prototype`. The final implementation uses only
captured own-property descriptors for all seven possible fields. Dedicated probes prove that
accessors are not invoked and that inherited, missing, accessor-backed, or trapped fields fail
closed.

Independent real-filesystem and synthetic oracles passed on Node.js 22.0.0, 22.23.2, 24.19.0, and
26.7.0. They covered directories, regular files, symbolic links, character devices mapped to
`other`, very large bigint identities, post-import intrinsic and builtin changes, source lazy Date
accessors, and directory-reader pre-IO rejection. The captured mode classification matched Node's
own mode predicate semantics across those runtimes.

The compatibility review verified every existing caller, the directory-reader refactor, package
construction, and the export map. No new package-root export exists, and direct internal subpath
imports remain blocked. The production dependency audit reports zero vulnerabilities.

## Verification

The final SHA-256 values are:

- `src/validate/file-metadata.ts`:
  `6e168e7d210ad0aea82f2785024839c3f814bf4c03ed6adbe39b153644edbdb5`
- `src/validate/directory-read.ts`:
  `29ba9145815c07c4ba23680abf54a2c29f0c1e11f820756c48b37b5df2a3be05`
- `test/file-metadata.test.ts`:
  `b877f7c40a10f524ce2c8d04bd310590ae843093073155fb49674e9dff62539f`
- `test/directory-read.test.ts`:
  `410566ada73b74f61775e8fcd10fe0d5ed1d71ad8af8b873f4fac4f181c86b9f`
- `test/skill-document-inspection.test.ts`:
  `664c019fddecb6f277643c3c080398faf0e49a3ee8814c7f581f1051d036577e`
- `test/skill-root.test.ts`:
  `84b48901c76f8f7d20420838b9e070ae6b2518328f46e9a7ef37816593f17040`

The final focused selection passes 75 tests. With deterministic cross-file isolation enabled, the
complete repository check passes 31 test files and 393 tests with 97.26% statement, 95.56% branch,
99.66% function, and 97.56% line coverage. `file-metadata.ts` reaches 95.91% statements, 100%
branches, 100% functions, and 95.23% lines; `directory-read.ts` remains above every per-file gate
at 94.14% statements, 90.19% branches, 100% functions, and 96.15% lines. Formatting, lint,
generated-file freshness, type checking, coverage thresholds, and `git diff --check` all pass.
