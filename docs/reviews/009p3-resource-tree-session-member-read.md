# Review 009p3: exact resource-tree session member reads

- Slice: `feat: read exact members through a resource-tree session`
- Review: independent API, contract, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `3136275b88cfead28a98a7b30bfb7dc8649870b4`
- Final result: PASS

## Scope and internal API

This slice adds one internal read operation and its result types to
`src/validate/resource-tree-session.ts`:

```ts
type ResourceTreeSessionMemberReadFailureReason =
  | "invalid_input"
  | "aborted"
  | "changed"
  | "unsupported_kind"
  | "too_large"
  | "invalid_metadata"
  | "invalid_read"
  | "invalid_utf8"
  | "inconsistent"
  | "io";

type ResourceTreeSessionMemberReadResult =
  | Readonly<{ ok: true; text: string; byteLength: number }>
  | Readonly<{ ok: false; reason: ResourceTreeSessionMemberReadFailureReason }>;

readResourceTreeSessionUtf8Member(
  sessionValue: unknown,
  entryValue: unknown,
  signalValue?: unknown,
): Promise<ResourceTreeSessionMemberReadResult>;
```

The byte limit is fixed at the existing 512 KiB skill-document limit. The operation accepts no
caller path, metadata, capture result, IO adapter, currentness callback, or limit. It does not add
a package-root export, exported package subpath, configuration option, schema field, retry,
timeout, session-context accessor, or generalized file-read authority.

Every direct outer result is frozen and has an own `then: undefined` data property that is
non-enumerable, non-writable, and non-configurable. Success exposes only `ok`, `text`, and
`byteLength`; failure exposes only `ok` and `reason`. Nested session state, source paths, native
errors, adapters, metadata, and producer results are not returned.

## B-only identity membership and registration

After opening captures A and B compare equal, the session now builds a private member map solely
from B. It does not authorize A identities or structurally similar entries. The map is a captured
WeakMap keyed by each exact B entry object; every value is a frozen private copy containing only
the role, relative path, and a fresh scalar metadata snapshot. Mutation of a structurally
fabricated producer entry after registration therefore cannot replace the retained role, path, or
metadata.

Registration fails closed as `inconsistent` if B has more than 8,192 entries, a sparse or
accessor slot, a proxy entry, a repeated entry identity, an ordinal that does not equal the
entry's zero-based `entryIndex`, a non-string relative path, malformed metadata, a missing or
inconsistent own metadata `kind`, or a role-kind mismatch. A directory role requires directory
metadata; document and resource-file roles require file metadata.

There must be exactly one document-role entry. Zero documents and duplicate documents are
inconsistent even when every individual record is otherwise well formed. This invariant belongs
to session registration; it is not inferred later from a read.

The member map, session, private context, and successful open result are all fully constructed
and frozen before the final signal sample. The tuple contents are copied to locals before that
sample. If the signal remains active, the only remaining state change is the captured
`sessionContexts.set(session, context)`, immediately followed by returning the already-barriered
result. A malformed B map still reaches that final signal checkpoint, so a concurrent abort or
signal invalidation retains priority over `inconsistent`.

## Read priority, paths, and currentness

The read priority is fixed:

1. authenticate the session through the private session-context WeakMap;
2. resolve the exact entry identity through that session's private B-member WeakMap;
3. validate and sample the optional signal;
4. reject a directory role as `unsupported_kind`;
5. derive the private absolute path and invoke the captured generic reader.

The first two checks are property-free. A fake, cloned, foreign, proxied, revoked, or wrong-session
entry is `invalid_input`; its properties are not inspected, and an invalid signal cannot override
that earlier identity failure. Conversely, a genuine directory with an already-aborted signal is
`aborted`, while the same directory with an active signal is `unsupported_kind`.

Path construction uses the captured path join operation, the retained genuine document root,
and the privately copied relative path. The join result must be a primitive string for every
file. For the sole document entry it must also equal the retained genuine document's exact path;
a mismatched document relative path is `inconsistent` before generic IO. The resulting inspected
file record is frozen and contains the copied B metadata. No caller-supplied path participates.

The generic call is the module-initialization-captured `readInspectedUtf8File`, receives the fixed
512 KiB limit and the exact retained compound session IO object, and therefore preserves the
reviewed lstat/open/fstat/read/fstat/close/lstat behavior of the bounded reader. This member
operation does not run another resource-tree capture or a whole-session comparison.

Its context callback captures the one retained root before asynchronous work. Each callback
invocation samples the signal before and after invoking the retained `rootIsCurrent` with an
`undefined` receiver and that exact root. Cancellation or signal invalidation becomes sticky;
once observed, it wins over later callback, generic-reader, and final-result outcomes. A root
callback rejection can propagate only into the generic Promise, whose rejection is normalized by
the session boundary.

## Native Promise and result normalization boundary

The generic callback's direct return is not awaited or otherwise assimilated until it passes a
module-local native Promise gate. The gate rejects proxies before reflection, requires captured
`node:util.types.isPromise`, requires the exact initialization-captured current-realm
`Promise.prototype`, and checks constructors without invoking accessors:

- an own `constructor` must be absent or an own data value equal to the captured Promise
  constructor; and
- the current own `Promise.prototype.constructor` descriptor must remain a data descriptor whose
  value is that captured constructor.

Promise subclasses, cross-realm Promises, Promise proxies, own constructor accessors, a poisoned
prototype constructor, structural thenables, and other non-native producers are therefore
`inconsistent` without reading or calling `then`. Only after this gate does the implementation
await the exact native Promise.

After settlement, the signal is sampled unconditionally. Sticky cancellation wins first, then
the final signal outcome, then producer-call, Promise-authentication, and rejection failures. Raw
result properties are not touched before these checkpoints.

A fulfilled result must be a non-proxy object with required own data fields. Successful text is
bounded by UTF-16 length before byte counting, its byte length must be a safe nonnegative integer
not equal to negative zero, and captured UTF-8 byte counting must match it exactly. Legal generic
failures map as follows: `too-large` to `too_large`, `invalid-metadata` to `invalid_metadata`,
`invalid-read` to `invalid_read`, and `invalid-utf8` to `invalid_utf8`; `io` is unchanged. A
`changed` result is accepted only for the generic reader's documented context/file subjects and
phases. Rejections, throws, malformed records, accessors, proxies, unknown reasons, and impossible
successes become the fixed raw-free `inconsistent` result.

## Authority and compatibility caveats

The session brand proves only that two bounded observations compared equal through one retained
adapter and that the returned entry is an exact member of the registered B observation. The
identity map, retained callbacks, member metadata, and before/after root-current checkpoints do
not prove openat-style containment, atomicity, permanent freshness, or absence of a
swap-away/read/swap-back sequence. Retained callbacks remain behavioral capabilities that may
reject, stall, consult mutable closure state, or change external state.

The post-import Object/Array stability is deliberately module-local. It is verified for reads
from an already genuine session and for an isolated 009p3 prepare/open composition. This slice
does not make the older capture, directory-read, lstat, and other transitive operations in a real
whole-session open immune to every live global constructor receiver. Those upstream boundaries
remain governed by their own reviewed contracts.

There is also a deliberate malicious-producer caveat at the module-initialization trust boundary.
If a hostile pre-import replacement returns an already-rejected Promise that fails the exact
Promise gate, 009p3 refuses to read or attach through its potentially hostile `then`; the host may
therefore report that rejected producer Promise as unhandled. The real captured file reader
returns the expected native Promise. The gate prevents thenable assimilation; it does not convert
an injected producer or native Promise into authority or promise universal immunity.

## Authored verification

The authored focused selection is two files and 11 tests: five member-read tests and the six
existing session tests. It covers real filesystem document/resource reads and replacement
detection; exact B identity and copied private state; session, member, signal, and directory
priority; dense-map and unique-document failures; document-path invariants; every legal generic
result mapping; malformed, accessor, proxy, negative-zero, byte-mismatch, rejected, and
non-Promise outcomes; sticky and final cancellation; result barriers; package-root absence; and
post-import intrinsic/global pollution.

The existing session fixture changed only as required to give isolated successful capture mocks
their one valid document entry. Existing open, currentness, comparison, baseline, IO-retention,
abort, registration-window, barrier, and public-boundary assertions otherwise remain intact.

Formatting, lint, type checking, focused execution, and diff checks pass. All 11 focused tests
pass. `resource-tree-session.ts` reaches 94.38% statements, 97.67% branches, 100% functions, and
94.36% lines.

The fresh candidate-only complete gate passes 44 files and 470 tests. Its global coverage is
96.32% statements, 95.07% branches, 99.76% functions, and 97.48% lines.

## API, compatibility, and release review

The API reviewer reconstructed the exact frozen base in a fresh no-hardlinks clone, copied only
the three frozen candidate files, verified every SHA-256 and `git diff --check`, and performed all
installation, build, and test work outside the shared workspace. It returned FINAL PASS with zero
blockers.

That reviewer added one private file with six tests, SHA-256
`81cad7a012cd68ca37a7980f579bc13ced684abac5e334e88f90d8309ecc3570`:

1. Distinct but semantically matching A/B document and resource records rejected the A resource
   identity and read the exact B resource once.
2. Zero-document and duplicate-document B captures each failed registration as `inconsistent`
   without calling the generic reader.
3. A sole document whose relative path joined outside the retained document path opened but was
   rejected at member-read time before generic IO.
4. An initialization-mocked join that returned a frozen object produced `inconsistent` with zero
   reader calls.
5. A Promise subclass with hostile `then`, a native Promise with an own constructor getter, and a
   native Promise observed while `Promise.prototype.constructor` was an accessor all failed the
   gate with zero getter or `then` observations.
6. Throwing post-import getters on global Object and Array did not affect an exact native producer
   Promise or the successful copied result.

For its cross-version regression, the API reviewer added the existing 37-test file-read suite to
the authored two files. The resulting three files and 48 tests passed on Node.js 22.23.2,
24.19.0, and 26.7.0. Adding the private six tests produced four files and 54 tests, and that exact
selection also passed on all three versions. The private suite is not part of the authored 11 or
candidate-only 470 tests. The complete gate with this private suite passed 45 files and 476 tests.

The API release review found zero production dependency vulnerabilities. A bare
`npm pack --json` executed prepack and build successfully and produced 179 entries, a 132,204-byte
tarball, and 686,984 unpacked bytes. A second independent base build confirmed that
`dist/index.js`, `dist/index.d.ts`, and `package.json` were byte-identical to the base.

The installed consumer confirmed version `0.1.0`, exactly 18 unchanged root runtime exports, and
the sole export-map key `.`. None of the three new member-read names or the five existing internal
session names appeared as a root runtime own key or in the root declaration text. The exact
internal session subpath returned `ERR_PACKAGE_PATH_NOT_EXPORTED`. A strict TypeScript 7.0.2
NodeNext consumer successfully imported and typed the existing `VERSION`,
`MAX_SKILL_DOCUMENT_BYTES`, and `validateAgentSkill` exports.

A separate installed compiled smoke fixture opened a genuine three-entry session, read exact
`resource.txt` text and 15-byte length, rejected a structured-cloned resource as `invalid_input`,
rejected a directory as `unsupported_kind`, and retained the exact frozen success barrier. The
temporary fixture was removed afterward.

## Adversarial review

The adversarial reviewer independently added one private file with five tests, SHA-256
`1cc90753089eca58423079d850bbcdbd49c019f2552730a504ff1eab3c851ed8`:

1. Two real-filesystem sessions remained readable after installing throwing global Object/Array
   accessors; the getters were untouched, result barriers were exact, and a session-one entry was
   rejected by session two.
2. Distinct semantic A/B entries locked B-only membership, isolated prepare/open global pollution
   touched no getter, and a producer-reachable exact 8,192-entry session registered and read its
   last member.
3. Promise-subclass `then`, own-constructor, and prototype-constructor attacks were rejected with
   zero hostile observations, while an exact native Promise succeeded without consulting a
   prototype `then` accessor.
4. Adding a `then` accessor to a raw record after its native Promise had settled did not invoke the
   getter; the record was copied and barriered, while a settlement-time abort overrode malformed
   raw data as `aborted`.
5. A captured join returning a non-primitive string produced `inconsistent` and zero generic
   reader callbacks.

The authored and adversarial selections together are three files and 16 tests. That exact
combination passed on Node.js 22.23.2, 24.19.0, and 26.7.0. Its complete gate passed 45 files and
475 tests, while the tracked candidate-only gate remained 44 files and 470 tests. The combined
run retained 94.38% statements, 97.67% branches, 100% functions, and 94.36% lines for the session
module, with global coverage of 96.32% statements, 95.07% branches, 99.76% functions, and 97.48%
lines. The five private tests are not included in the authored or tracked-only counts and were not
combined with the API reviewer's separate six-test suite.

The adversarial review independently reported zero total and production vulnerabilities and the
same bare pack result: prepack/build success, 179 entries, 132,204 packed bytes, and 686,984
unpacked bytes. Its fresh installed consumer confirmed version `0.1.0`; absence of the three new
member-read names from both root runtime and root declarations; and
`ERR_PACKAGE_PATH_NOT_EXPORTED` for the exact internal session subpath.

## Additional independent contract audit

An independent fourth audit returned zero blockers after static review of the registration
window, Promise-await boundary, and result normalizer. In a private temporary snapshot it ran one
additional six-test Promise-focused file together with the authored two-file, 11-test selection.
The private tests locked own/prototype `then` and constructor boundaries plus the exact Promise
gate without broadening authority. Build and targeted format, lint, type, and diff checks passed.
The temporary files were removed afterward.

That fourth audit did not run a complete gate, Node matrix, pack, audit, or consumer check. Its
six private tests are not included in the authored, API-private, adversarial-private, or complete
gate totals above and are recorded only as focused supplemental evidence.

## Frozen files

The candidate is based on `3136275b88cfead28a98a7b30bfb7dc8649870b4`. Its three frozen
SHA-256 values are:

- `src/validate/resource-tree-session.ts`:
  `01b3fa4d8bd4f1379d44c68d3a4738ab6c48a17287806d787b94dbed24bf4dd3`
- `test/resource-tree-session-member-read.test.ts`:
  `9d712e4b511adc9b01da30ca71052a80fb15790f11d7d71cfea4c689ae63d8a4`
- `test/resource-tree-session.test.ts`:
  `a78a9dcc84591488cdaaf1f480fd97d40b31248bbf410280aaffb3da12230336`

The production diff is a net 302 lines. The new focused test is 678 lines, and the existing
session test changes only the minimal valid-document fixture. Only these three frozen files and
this review record belong to the slice. No package-root export, export-map entry, schema, or
public configuration surface changed.
