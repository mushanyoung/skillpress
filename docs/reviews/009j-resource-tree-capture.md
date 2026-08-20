# Review 009j: single-pass resource-tree capture

- Slice: `feat: capture one bounded resource tree`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `1c9cae20cef15a4ec81e8973c071d06273f05a74`
- Final result: PASS

## Scope and guarantees

The new internal `captureInspectedResourceTree(document, signal, io)` operation captures one
deterministic, bounded resource tree from a genuine `DocumentInspection`. Its injected
`ResourceTreeCaptureIo` combines the existing directory-read and resource-tree-lstat adapters with
one `rootIsCurrent(root)` callback. The function validates the genuine document and root before
reading their fields, and then requires the captured join of the root path and exact `SKILL.md` to
equal the inspected document path. A branded-input failure is `invalid_input`; a failure of that
trusted path invariant is `inconsistent`.

Success contains only a frozen root observation and a frozen dense entry array. The root retains
its root layout, the metadata observed by the successful root reader, and that reader's genuine
`DirectoryNameIndex`. Every entry retains its resource-tree layout and initial complete metadata.
Document and resource-file entries carry their role, while directory entries additionally retain
their genuine name index. The root does not count as an entry; every child does. Array ordinal is
the zero-based `entryIndex`, and parent indices preserve the DFS tree. No absolute path, input
inspection, active budget token, callback, signal, native error, subject, phase, or failure detail
is returned.

Failures are fixed frozen `{ ok: false, reason }` values. Producer failures and observed states are
normalized as follows:

| Source | Capture reason |
| --- | --- |
| Invalid document/root provenance, invalid signal sample, or lstat helper `invalid_input` | `invalid_input` |
| Cooperative pre/post cancellation, including lstat helper cancellation | `aborted` |
| Missing exact root `SKILL.md`, snapshot mismatch, or non-true final root currentness | `changed` |
| Invalid directory read, oversized or invalidly encoded name, or name-index construction failure | `invalid_inventory` |
| Directory-reader or lstat metadata rejection | `invalid_metadata` |
| Ordinary symbolic-link or other-kind child | `unsupported_kind` |
| Reader entry cap or layout entry budget | `too_many_entries` |
| Layout depth budget | `too_deep` |
| Aggregate relative-path UTF-8 budget | `paths_too_large` |
| Reader `invalid-inspection`, reprofile failure, impossible layout state, duplicate logical path, or internal composition failure | `inconsistent` |
| Adapter validation, operation rejection, reader IO, or final currentness rejection | `io` |

After the bounded root reader succeeds, capture scans its trusted sorted index for exact
`SKILL.md` before creating a layout, reserving a child, or lstatting any child. Case aliases do not
satisfy this gate. Each selected ordinal is then reprofiled through the genuine-index bridge,
reserved against the single linear layout budget, joined from its exact spelling, and observed by
the cooperative lstat helper. Reservation therefore precedes kind filtering and child IO, so cap,
depth, aggregate-byte, and duplicate-path failures cannot be bypassed through unsupported entries.

Entries use exact UTF-16 sibling order and DFS preorder. The exact root `SKILL.md` must match the
inspected document's complete metadata and file kind before it becomes the sole `document` entry;
a nested file with that spelling is an ordinary `resource-file`. A directory is first
lstat-observed, then read as one bounded transaction, appended with its retained index, and
recursively traversed.
After its descendants succeed, it is lstat-observed again and fully compared with its initial
metadata. A directory at relative depth 64 is still opened and read to EOF; only a valid child at
depth 65 fails reservation, before that child is joined or observed.

After all descendants, capture lstat-checks the root directory, lstat-checks the inspected
document, and finally requires a strictly true `rootIsCurrent` result. All explicit identity checks
use the captured complete-snapshot comparator. Post observations verify rather than replace the
metadata retained from the root reader or initial child lstat. Descendant failures win before a
parent's postorder check, and only after the final currentness await succeeds does synchronous
freezing publish the result.

## Cancellation and authority boundary

Cancellation remains a non-authoritative cooperative hint. Initial validation samples the signal
before IO capture; an invalid initial sample wins over invalid IO, while invalid IO wins over an
already-aborted valid signal. Each complete directory-reader transaction and the final
`rootIsCurrent` operation has a pre- and post-await sample. Each lstat delegates to the previously
reviewed helper and therefore has its own pre/post samples. A post-sample of invalid or aborted
overrides the awaited operation's result or rejection. Directory-reader cleanup, including a
`finally` close, finishes before the outer post-sample. No listener, reason read, timer, retry,
`Promise.race`, or `throwIfAborted` is used, and in-flight work is not interrupted.

Module initialization captures the filesystem bindings, path join, invocation/freezing/own-slot
intrinsics, native bigint options, provenance checks, name reprofiling, layout reservation,
directory reader, lstat helper, signal sampler, and full metadata comparator. The three IO
callbacks are captured once from own data properties in the fixed order `lstatPath`,
`openDirectory`, then `rootIsCurrent`, and are subsequently invoked with an undefined receiver.
The entry array is populated through captured own-property definition and numeric indexing rather
than array methods or live iterators.

The completed pass is deliberately unbranded and grants no traversal or session authority. It is
a bounded observation assembled through pathname-based `lstat` and `opendir`, not an
`openat`-style traversal anchored to retained directory handles. Consequently, an adversary able
to swap a pathname away and back between checkpoints with indistinguishable full metadata can
escape observation. The pre/post snapshots and root-current checks detect changes that they
observe; they do not prove that no swap-back occurred. Callers must not promote this pass into
filesystem authority without a later authority mechanism designed for that threat model.

## Independent review

Two reviewers reconstructed the frozen candidate in fresh private worktrees and returned PASS
with zero blockers. The API reviewer replayed the authored two-file, seven-test focused suite on
Node.js 22.23.2, 24.19.0, and 26.7.0; all seven tests passed on every version. That reviewer also
ran one private file containing two additional tests, separate from the authored and repository
counts. The first used a real filesystem tree containing `0.txt`, `SKILL.md`, and `dir/x.txt` to
verify exact preorder, dense indices, roles, retained genuine root and directory indexes, index
lookup and reprofiling, the directory/document lstat counts, and the final root-lstat,
document-lstat, root-current tail. The second supplied a hostile fabricated root-reader inventory
without exact `SKILL.md` and confirmed `changed` after the completed root transaction but before
any child lstat.

The adversarial reviewer added one independent oracle file with nine tests, SHA-256
`b95d35fb44bfffcc8d702fe355337eea23f3c23a9c06017d602bdc9ccc25aa44`. Together with the two
authored files, the three-file, 16-test matrix passed on Node.js 22.23.2, 24.19.0, and 26.7.0. The
nine probes covered deterministic UTF-16 preorder under three physical permutations and the
complete reader/postorder/final trace; exact root-document membership and malformed inventories;
post-cleanup abort and invalid-signal precedence; descendant failure before ancestor postchecks;
the exact 8,192-entry and 8 MiB aggregate boundaries and their one-step failures before child
lstat; property-free rejection of proxy, clone, foreign, and revoked inspection substitutes; one-
time callback capture and receivers under adapter and path-binding mutation; deep-frozen,
unbranded, raw-free output; and captured default filesystem bindings on a real tree.

The author's complete frozen-candidate gate passed 37 files and 432 tests. The adversarial
reviewer's complete gate included its extra file and passed 38 files and 441 tests, exactly one
file and nine tests more. With the extra oracle, the capture module reached 93.54% statements,
92.18% branches, 100% functions, and 97.23% lines. The API review's two private tests were run
separately and are not included in the authored focused count, the author's complete gate, or the
adversarial nine-test count.

Both independent reviews reported zero production dependency vulnerabilities. A bare
`npm pack --json` ran prepack and its build successfully, producing 163 files, a 110,655-byte
tarball, and 561,510 unpacked bytes. Installed-consumer checks covered the six forbidden names
`captureInspectedResourceTree`, `ResourceTreeCaptureResult`, `ResourceTreeCaptureIo`,
`CapturedResourceTreeRoot`, `CapturedResourceTreeEntry`, and
`ResourceTreeCaptureFailureReason`: each was absent from the package-root runtime object and from
the root declaration output. Importing the internal capture subpath failed with the exact code
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Verification

The frozen candidate is based on
`1c9cae20cef15a4ec81e8973c071d06273f05a74`. Its implementation SHA-256 is
`37657d54876ae1be8d88f3d54596a105aa6025280d82a97d4d53d255418791e2`. The two focused-test
SHA-256 values are `c09bafb3c653cb3b15ac0d0dd56ad6aea7ec7f7f3f7e01c6066fcc38eb73fd09` and
`9f757aad32a50e6095e49f1c55ad32dd6e1ed7464c2b7b6dfe8f5edc2dbdc51e`.

The authored focused verification passes two files and seven tests. The complete frozen-candidate
check passes 37 test files and 432 tests with 96.85% statement, 95.20% branch, 99.70% function,
and 97.59% line coverage. The new resource-tree-capture module reaches 93.08% statements, 91.40%
branches, 100% functions, and 97.23% lines. Formatting, lint, generated-file freshness, type
checking, build, coverage thresholds, and `git diff --check` all pass for this pre-commit
candidate.
