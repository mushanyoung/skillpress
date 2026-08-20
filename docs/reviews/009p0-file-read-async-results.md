# Review 009p0: non-thenable file-read async results

- Slice: `fix: barrier file-read async result records`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `7c66b690aab5b208f48c8d9ab31be30e1fbde2d0`
- Final result: PASS

## Scope and result boundary

The internal `file-read` module now applies a local non-thenable barrier to every ordinary result
record that `readInspectedUtf8File` constructs and returns directly across its async boundary. The
private `freezeAsyncResult` helper first defines an own `then` data property whose value is
`undefined` and whose `enumerable`, `writable`, and `configurable` attributes are all false. It then
freezes the record.

The covered outer result shapes are:

1. Fresh simple failures from `failure`, including `too-large`, `invalid-metadata`, `invalid-read`,
   `invalid-utf8`, and `io`.
2. Fresh context-change failures from the context branch of `changed`.
3. Fresh file-change failures from the file branch of `changed`.
4. The final success record containing `ok`, `text`, and `byteLength`.

The result identities remain fresh. The hidden property does not change the existing discriminated
union, enumerable key order, JSON form, or ordinary object prototype. Every outer result remains
frozen. Native Promise resolution therefore finds the own noncallable value before an inherited
`Object.prototype.then` data property or getter can reinterpret one of these direct results as a
thenable.

Module initialization captures `Reflect.apply`, the current Object constructor,
`Object.defineProperty`, and `Object.freeze`. The barrier invokes the captured definition and
freeze operations through the captured apply operation and Object receiver. Existing default-IO,
inspected-file, and copied-metadata freezing also uses the captured freeze capability, without
adding a hidden barrier to those nested or synchronous values.

No filesystem callback, flag, byte limit, metadata comparison, UTF-8 rule, currentness check,
exception normalization, or public TypeScript result field changed. In particular, return
expressions still precede the existing async `finally` close, a handle is still closed exactly
once, and a close failure still cannot replace already copied bytes or the selected result. The
slice adds no abort behavior, retry, authority, session integration, or package-root export.

## Deliberate caveat

This is a `file-read`-local barrier on direct outer records only. It does not harden a native or
producer Promise before `file-read` receives its fulfillment, native Promise machinery itself, an
IO callback or handle, the default adapter, the copied inspection or metadata, the returned text,
or any other nested value. An upstream promise can therefore still be affected before this module
constructs a result wrapper.

The hidden property is non-enumerable. Object spread, ordinary copying, JSON round trips, and
structured cloning do not preserve it, so a downstream clone can again inherit a hostile `then`.
The change is not a provenance, authenticity, freshness, or general thenable-immunity mechanism;
it closes only the reviewed direct async-return windows.

## Authored verification

The authored focused selection is one file and 34 tests. It covers the exact descriptor and
unchanged enumerable shape on success, simple failure, context change, and file change; inherited
direct-callable and getter-provided callable values on an early zero-IO failure; file-change and IO
results selected before a `finally` close that installs inherited pollution; close-once behavior;
and post-import replacement of the live Reflect and Object capabilities. The inherited getter and
callable remain unobserved, and the live poison functions remain uncalled.

Formatting, lint, type checking, the focused selection, and `git diff --check` pass. The focused
`file-read` module coverage is 100% statements, 100% branches, 100% functions, and 100% lines. The
fresh tracked complete gate passes 42 files and 459 tests without either reviewer's private suite.

## API review

The API reviewer reconstructed the two frozen files independently and returned FINAL PASS with
zero blockers. It replayed the authored one-file, 34-test selection on Node.js 22.23.2, 24.19.0,
and 26.7.0; all 34 tests passed on each version. The review did not claim that its private oracle
was run across this Node matrix.

That reviewer separately ran a built-distribution oracle with two paths and 24 assertions:

1. Under an inherited getter-provided callable `then`, it executed two consecutive early failures
   and verified fresh identities, zero getter and callable invocations, the exact hidden
   descriptor, unchanged keys and JSON, the ordinary prototype, and frozen results.
2. It exercised an opening-time file change where `handle.close` installed the inherited `then`
   only inside the `finally` path, then verified one close, zero inherited getter or callable
   invocations, and the same exact result shape and descriptor.

Those two paths and 24 assertions are a separate built-distribution oracle, not additions to the
authored 34-test selection or the tracked 42-file, 459-test complete gate.

The API review reported zero production dependency vulnerabilities. A bare `npm pack --json`
executed prepack and build successfully and produced 175 files, a 127,714-byte tarball, and
657,007 unpacked bytes. Its seven fresh-consumer checks confirmed the package version; absence of
`readInspectedUtf8File` from root runtime own exports; absence of `readInspectedUtf8File`,
`InspectedUtf8FileReadResult`, `InspectedFileReadIo`, and `FileOpenCapabilities` from the root
declaration output; and `ERR_PACKAGE_PATH_NOT_EXPORTED` for
`@mushanyoung/skillpress/dist/validate/file-read.js`.

## Adversarial review

The adversarial reviewer independently added one private file with four tests, SHA-256
`0b68951f26255749bdf35b5ab0f60246e5adb58f93773fa6b792d8c8ee3bc227`:

1. It tested callable own-data and getter-provided callable forms of `Object.prototype.then` on a
   zero-IO early `invalid-metadata` result. Both retained the exact descriptor, keys, JSON,
   prototype, and frozen state with zero inherited reads or calls.
2. It tested a rejecting `handle.stat` normalized to `io` and an early `invalid-read`. Their
   `finally` closes respectively installed accessor and data-property forms of `then`; each handle
   closed exactly once, neither inherited value was observed or called, and both results retained
   the exact barrier.
3. It installed an accessor `then` at the second, final context checkpoint, covering success,
   `invalid-utf8`, and a context change during reading. Each operation made exactly two context
   checks, performed zero inherited reads or calls, and retained the expected barriered result.
4. It polluted live `Reflect.apply`, `globalThis.Object`, and the original Object constructor's
   `defineProperty` and `freeze` during a complete successful read. No poison function was called,
   and the success result retained the exact descriptor and shape.

The authored and private selections together are two files and 38 tests. The adversarial reviewer
ran that exact combination on Node.js 22.23.2, 24.19.0, and 26.7.0; all 38 tests passed on every
version. Its complete gate with the private file passed 43 files and 463 tests, while its
tracked-only gate passed the same 42 files and 459 tests recorded above. The `file-read` module was
100% covered in statements, branches, functions, and lines. Both the tracked-only and combined
complete runs reported global coverage of 96.45% statements, 94.93% branches, 99.75% functions,
and 97.67% lines.

The private four-test oracle is included only in the adversarial two-file, 38-test Node matrix and
43-file, 463-test complete gate. It is distinct from the API reviewer's two-path, 24-assertion
oracle, and the two private suites are not added together in any claimed run.

The adversarial review independently reported zero production dependency vulnerabilities and the
same bare pack result: successful prepack build, 175 files, 127,714 packed bytes, and 657,007
unpacked bytes. Its fresh tarball consumer first confirmed the package version, then confirmed
that `readInspectedUtf8File`, `freezeAsyncResult`, `InspectedUtf8FileReadResult`,
`InspectedFileReadIo`, and `InspectedFile` were absent from both package-root runtime own exports
and the root declaration output. The exact internal subpath above remained blocked with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Frozen files

The candidate is based on `7c66b690aab5b208f48c8d9ab31be30e1fbde2d0`. Its implementation
SHA-256 is `ac5df6c663c9c2a9edb885449930aed57f1fc0d18d4ca53b639bd1cee7040f1e`, and its targeted-test
SHA-256 is `2d0a13211b3b32dbbcf990676cf8f1db005337b1d08b0d8481159bfe6e03cb11`.

The production diff is a net 19 lines and the focused-test diff is a net 135 lines, within the
reviewed slice targets. Only `src/validate/file-read.ts`, `test/file-read.test.ts`, and this review
record belong to the slice. No package-root export, export-map entry, schema, or public API surface
was added.
