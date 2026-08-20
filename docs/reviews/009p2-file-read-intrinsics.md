# Review 009p2: captured file-read intrinsics and bounded byte copying

- Slice: `refactor: harden file-read byte copying intrinsics`
- Review: independent API, bounded-design, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `30f00800e9b05eb79333e62cddee3d6705e3b807`
- Final result: PASS

## Scope and unchanged API

This slice hardens the existing internal `readInspectedUtf8File` implementation without changing
its function signature, result union, enumerable result shapes, non-thenable result barriers,
failure priority, filesystem trace, currentness checkpoints, or close timing. It changes only
`src/validate/file-read.ts` and its existing focused test before adding this review record.

The module now captures at initialization:

- native `node:fs/promises` `lstat` and `open` bindings;
- `O_RDONLY`, `O_NOFOLLOW`, and `O_NONBLOCK` values;
- `Number`, `Number.isSafeInteger`, and `BigInt`;
- the `node:buffer` Buffer constructor and its `alloc` function;
- the TextDecoder constructor and `TextDecoder.prototype.decode`; and
- `Reflect.apply`, the Object constructor, `Object.defineProperty`, and `Object.freeze`.

The default lstat wrapper uses the captured native function and a frozen bigint options record.
The default open callback and capability booleans likewise derive only from initialization-time
bindings and scalar constants. Buffer allocation invokes the captured `alloc` through the
captured apply operation with an `undefined` receiver. UTF-8 decoding constructs the captured
decoder and invokes the captured decode method through the captured apply operation.

No package-root export, export-map entry, schema, configuration option, abort behavior, retry,
session API, result field, or authority surface was added. The package-root JavaScript and
declaration outputs remain byte-identical to the frozen base and retain the same 18 exports.

## B-prime bounded-copy design

The final B-prime design avoids both live Buffer convenience operations and a per-read chunk
object graph. After the opened descriptor metadata has matched the inspected file, its size is
already nonnegative and no larger than the caller's validated limit, which itself is capped at
512 KiB. The captured Number constructor therefore converts that bigint size exactly. The reader
then allocates only:

1. one 64 KiB scratch Buffer passed to the handle; and
2. one private Buffer whose length is exactly the validated opened size and which is never passed
   to the handle.

For every positive read, each claimed scratch byte is fetched by integer index and must be a
primitive number. A detached scratch buffer therefore yields `invalid-read` instead of silently
copying zeroes. Bytes whose absolute positions are within the opened size are copied directly to
the private Buffer. Any claimed growth beyond that size is still validated and counted but is not
stored; the existing `too-large` and post-read full-metadata/length checks retain their original
priority and select the eventual result.

The implementation no longer depends on live `Buffer.from`, `Buffer.prototype.subarray`,
`Buffer.concat`, `Array.prototype.push`, `Math.min`, or a Buffer `length` lookup. It does not
create a Buffer, record, or array slot per short read. Once all existing post-read descriptor,
path, and context checks pass, the captured decoder reads the exact private Buffer directly, so
there is no final flattening allocation or second JavaScript copy.

The raw private-buffer peak is at most 64 KiB plus 512 KiB, or 576 KiB. There are exactly two
Buffer allocations per opened read regardless of short-read count. At most `maxBytes + 1` claimed
source bytes are inspected, at most the opened size is copied into private memory, and decoding
examines at most 512 KiB. Both memory and synchronous byte work are therefore linear in the
existing byte limit rather than in an adapter-selected chunk count.

Allocation and Number-conversion failures remain normalized by the outer `io` boundary. Invalid
read counts and detached/non-number scratch bytes remain `invalid-read`; decoder construction or
decode failure remains `invalid-utf8`. The existing post-read comparison and context ordering,
including file change before context change, is unchanged. Every opened handle is still closed
exactly once on the new detached-buffer return path and on all pre-existing paths.

## Trust and result caveats

This is module-local hardening, not a new authority mechanism. Caller-supplied IO callbacks,
handles, and currentness callbacks remain behavioral capabilities: they can reject, stall, mutate
their closure state, lie about results, or detach the scratch Buffer. Capturing callback and
intrinsic identities does not prove containment, openat-style identity, atomicity, permanent
freshness, swapback resistance, or honest adapter behavior.

The implementation cannot cancel an in-flight callback and does not add an abort checkpoint. It
continues to normalize callback and filesystem failures according to the pre-existing contract.
The 009p0 hidden `then: undefined` barrier still covers only direct outer async result records;
upstream promises, native Promise machinery, nested values, downstream copies, and external
adapter behavior remain outside that barrier.

## Authored verification

The authored focused suite is the existing `test/file-read.test.ts`, now 37 tests. It retains the
full earlier behavior and barrier matrix and adds or strengthens coverage for:

- an exact 64 KiB plus 17-byte payload whose BOM and three-byte euro sign cross the scratch-read
  boundary;
- a handle that detaches the scratch buffer after reporting a byte, producing `invalid-read` and
  closing exactly once;
- one-byte reads through EOF, with exactly two captured allocations of 64 KiB and the four-byte
  opened size, an `undefined` `Buffer.alloc` receiver, and five read calls;
- individual and combined post-import replacement of Number, BigInt, Buffer allocation and old
  chunk/concat paths, Buffer transitive conversion and view surfaces, Buffer pool/species and
  numeric prototype surfaces, Math, Array push and numeric setters, TextDecoder decode, Reflect,
  and Object definition/freezing operations; and
- synchronized replacement of live fs-promises, buffer, and util built-in exports while the
  initialization-captured defaults continue to read `SAFE` and invoke no replacement.

The normal operation-order test, close-once matrix, changed-result priority, raw-free failures,
and exact hidden result descriptor remain in the same focused suite. Formatting, lint, type
checking, focused execution, and diff checks pass. All 37 tests pass, and `file-read.ts` reaches
100% statements, 100% branches, 100% functions, and 100% lines.

The fresh tracked complete gate passes 43 files and 465 tests. Its global coverage is 96.52%
statements, 95.03% branches, 99.75% functions, and 97.72% lines.

## API, compatibility, and release review

The API reviewer returned FINAL PASS with zero blockers. It replayed the authored 37-test file on
Node.js 22.23.2, 24.19.0, and 26.7.0, with all 37 tests passing on each version. Its fresh tracked
complete gate also passed 43 files and 465 tests.

Separately, that reviewer ran a baseline-differential suite on all three Node versions. Each run
covered 26 scenarios and made 448 assertions while comparing the frozen-base and candidate
observable behavior. The reviewer reported no unintended public API, result, priority, trace,
close, or barrier drift. These scenarios and assertions are separate private evidence; they are
not added to the authored 37 tests or the tracked 43-file, 465-test gate.

The API release review found zero production dependency vulnerabilities. A bare
`npm pack --json` executed prepack and build successfully and produced 179 files, a 129,307-byte
tarball, and 667,416 unpacked bytes. It compared the built package-root JavaScript and declaration
outputs against the base byte for byte and confirmed the unchanged 18-export surface.

For transparency, the API reviewer accidentally executed one `npm run build` in the shared
workspace during review. It was not `npm run check`; immediate tracked-file, status, and frozen-SHA
checks showed no change. The authored work did not run a shared full gate, and all other API
review, cross-version, complete-gate, pack, and compatibility evidence was produced in fresh
review space.

## Adversarial review

The adversarial reviewer independently added one private file with five tests, SHA-256
`668886c901b463844cbc553f0e527dee0cc69d822e1f6d7c195eedd3bcb68459`:

1. It read a 64 KiB plus 17-byte BOM payload with a boundary-crossing euro sign and locked the
   exact IO trace plus a SHA-256 content digest.
2. It completed 273 one-byte positive reads followed by EOF, locking their order, the content
   digest, and one close.
3. It allowed the first short read, detached the scratch buffer during the second, and verified
   `invalid-read`, zero post-read context checks, and exactly one close.
4. It combined dependency replacement, an Array-prototype numeric setter, and an inherited
   `then` accessor returning a callable. The exact bytes and digest remained stable; scalar call
   counters recorded two lstats, two fstats, two reads, one open, and one close; and the direct
   outer result retained its exact non-thenable barrier.
5. It used `syncBuiltinESMExports()` after replacing live fs, buffer, and util bindings. Default IO
   still returned `SAFE`, and none of the replacement functions was invoked.

The authored and adversarial selections together are two files and 42 tests. That exact
combination passed on Node.js 22.23.2, 24.19.0, and 26.7.0. The adversarial tracked-only coverage
run passed 43 files and 465 tests; its complete gate with the private file passed 44 files and 470
tests. The combined run retained 100% statements, branches, functions, and lines for
`file-read.ts`, with global coverage of 96.52% statements, 95.03% branches, 99.75% functions, and
97.72% lines. The private five tests are not included in the authored or tracked-only counts.

The adversarial release review independently reported zero production dependency
vulnerabilities. Its installed tarball consumer confirmed package version `0.1.0`; absence of
`readInspectedUtf8File`, `InspectedUtf8FileReadResult`, `InspectedFileReadIo`,
`InspectedFileHandle`, and `InspectedFile` from both root runtime own exports and the root
declaration output; and `ERR_PACKAGE_PATH_NOT_EXPORTED` for the exact internal subpath
`@mushanyoung/skillpress/dist/validate/file-read.js`.

## Frozen files

The candidate is based on `30f00800e9b05eb79333e62cddee3d6705e3b807`. Its implementation
SHA-256 is `9bf7b2d15a9f61b65f158fb2bdb536591d182e09fe3b8d041cbaad20840b8d7f`, and its targeted-test
SHA-256 is `f3cc704706ac312d663284208a4fb2cb608586990464f3701dd29463950c70c7`.

The production diff is a net 19 lines and the focused-test diff is a net 178 lines. Only
`src/validate/file-read.ts`, `test/file-read.test.ts`, and this review record belong to the slice.
No public API, root export, export-map entry, schema, or configuration surface changed.
