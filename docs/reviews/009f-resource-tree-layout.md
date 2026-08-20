# Review 009f: bounded resource-tree layouts

- Slice: `feat: budget resource tree layouts`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `24268ca6c9656e5f323cbdbd69b1fd22089ffe81`
- Final result: PASS

## Scope and guarantees

The new internal layout state machine reserves logical resource-tree entries before later child
kind or metadata filtering. Its root has depth zero, an empty logical path, and no entry ordinal;
it consumes neither the entry count nor the aggregate relative-path budget. Child entries receive
contiguous zero-based ordinals and parent ordinals, while top-level entries have a null parent.

Each layout has one private owner and a linear, one-shot budget-token chain. A structurally valid
attempt consumes its current token before checking limits, and only a successful reservation
creates the unique successor. Stale-token reuse, branch creation, cross-layout parents, cloned
locations, and forged profiles therefore fail without creating duplicate ordinals or letting a
caller split the accounting across parallel branches.

The inclusive limits are 8,192 child entries, relative depth 64, and 8 MiB of aggregate exact
relative-path UTF-8 bytes. Every path charge includes the complete logical relative path, not just
the leaf name. The fixed limit order is entry count, depth, aggregate path bytes, then exact path
duplication. Every limit or duplicate failure is terminal for the claimed token.

Logical paths use exact observed name spellings joined with a literal `/`. Their component byte
lengths come only from genuine successful resource-name profiles. A private, non-iterated exact
path set rejects duplicate logical paths; distinct NFC or fixed-fold aliases remain separate
observations so the directory index can report their portability collision instead of silently
deduplicating them. The set, owner state, and provenance maps never appear in returned objects.

The module also provides a total, frozen result for comparing genuine sibling-name profiles in
binary UTF-16 code-unit order. It is deliberately not described as a flattened-path or DFS
comparator. Deterministic traversal order will come from each directory's existing exact-name
index followed in preorder.

All successful and failed results are frozen and contain no host or absolute filesystem paths,
metadata, native errors, callbacks, or caller objects. Filesystem access, child kinds, metadata
snapshots, tree capture, and the two-pass currentness session remain outside this slice. No
package-root export or package subpath was added.

## Independent review

The API review reconstructed the candidate from the frozen base and verified owner isolation,
one-shot budget consumption, zero-based parent linkage, exact path accounting, duplicate handling,
failure priority, deep freezing, and the package export boundary. It also confirmed that the
future DFS adapter must re-profile each exact name copied from a genuine directory index before
reserving it, and then visit those already-sorted entries in preorder.

The adversarial review independently exercised the implementation on Node.js 22.0.0, 24.0.0, and
26.7.0. Its depth-64, 8,192-entry, and exact-8-MiB fixtures matched their frozen semantic digests;
each plus-one operation failed with the intended terminal reason. The 8-MiB fixture included
non-NFC and astral 255-byte components and 480 unique depth-64 leaves. A separate ordering oracle
proved the intended UTF-16 order for ASCII, an astral scalar, and a BMP private-use scalar.

Additional attacks covered stale branching, duplicate-path consumption, cross-owner parents,
same-name children under different parents, NFC and fixed-fold aliases, clones, inherited fields,
accessors, proxies, revoked proxies, foreign module instances, hostile numeric shapes, and
post-import mutation of the captured Object, Reflect, WeakMap, WeakSet, Set, and String
capabilities. The final candidate passed without invoking hostile getters or live replacement
methods and without reflecting input data into failures. Replacement of live Buffer, Number, and
Array methods separately proved that the implementation does not depend on them.

## Verification

The final SHA-256 values are:

- `src/validate/resource-tree-layout.ts`:
  `509eb14ad7ffa8cab2f6ebf214ee24c8a24b76772ce47fb13bb1d6a0756c8718`
- `test/resource-tree-layout.test.ts`:
  `00a201bb6a218c10e4305ebca53b2e4e9c5f17810b5ff45c25a48daf74da36c9`

The committed layout suite passes 11 tests; the broader focused Vitest selection adds the 12
resource-name-profile tests for 23 total, and the independent review runs nine additional grouped
oracle suites. The complete repository check passes 32 test files and 404 tests with 97.24%
statement, 95.52% branch, 99.67% function, and 97.62% line coverage. The new module reaches 96.9%
statements, 94% branches, 100% functions, and 98.91% lines. Formatting, lint, generated-file
freshness, type checking, coverage thresholds, and `git diff --check` all pass. The production
dependency audit reports zero vulnerabilities, and the dry-run package contains 151 entries while
keeping the new module behind the existing package export map.
