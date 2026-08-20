# Review 009i: cooperative resource-tree lstat

- Slice: `feat: lstat resource-tree paths cooperatively`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `d4872d4e25a60346d2b277ba16cfc3b3f37131a4`
- Final result: PASS

## Scope and guarantees

The new internal `lstatResourceTreePath(path, signal, io)` helper performs at most one `lstat` and
returns a frozen `ResourceTreeLstatResult`. Success contains only `ok` and a complete frozen
`FileMetadataSnapshot`; the fixed frozen failures contain only `ok` and one of `invalid_input`,
`aborted`, `invalid_metadata`, or `io`. The `ResourceTreeLstatIo` interface supplies one
`lstatPath(path)` callback for deterministic tests and later resource-tree capture reuse.

The fixed pre-operation precedence is primitive-string path validation, invalid pre-signal sample,
invalid IO adapter, then an already-aborted pre-signal sample. Thus an invalid IO adapter wins over
a valid but aborted signal. After the single callback settles, the helper samples again before
inspecting either a fulfilled metadata value or a rejection. An invalid post-sample wins first,
then an aborted post-sample, then callback rejection as `io`, and finally metadata snapshot failure
as `invalid_metadata`.

Cancellation is deliberately cooperative and non-authoritative. For an operation that reaches the
callback and await, the same captured sampler used by the preceding cancellation slice is called
once before and once after the await. No listener, abort reason, racing promise, timer, retry, or
`throwIfAborted` is used. In-flight work is not interrupted: the callback is allowed to settle,
after which the post-sample can override either its fulfilled value or its rejection. Cancellation
grants no filesystem, path, containment, currentness, role, or session authority.

The IO adapter must provide `lstatPath` as an own data property whose value is callable. The helper
captures that current callback once without invoking a property getter. When the operation
proceeds, it calls the callback exactly once with `this` set to `undefined` and the original string
as its only argument. Empty, NUL-containing, and non-NFC strings are passed unchanged. A transparent
proxy that supplies a valid descriptor can therefore work; descriptor traps may run and their
failures normalize to `io`, so this adapter gate is not described as a provenance brand.

Module initialization captures native `lstat`, a frozen `{ bigint: true }` options object,
invocation, freezing and own-descriptor intrinsics, the cooperative signal sampler, and the
metadata snapshot producer. The default native operation is `lstat`, not `stat`, and therefore
does not follow a terminal symbolic link. All four derived kinds—file, directory, symbolic link,
and other—are successful metadata observations; kind filtering belongs to the later capture layer.
The result retains no input path, signal, IO object, native error, token, or brand. The helper adds
no join, resolve, traversal, filtering, currentness, or package-root export.

## Independent review

Two reviewers reconstructed the frozen candidate in fresh private worktrees and returned PASS
with zero blockers. The API reviewer replayed the authored one-file, nine-test focused suite on
Node.js 22.23.2, 24.19.0, and 26.7.0, then ran one independent group containing four additional
tests. Those four tests verified exact preservation of all seven metadata fields and the frozen
minimal success shape; a valid descriptor trap that synchronously aborts yet still leads to one
callback and a post-operation `aborted` result; a descriptor trap that aborts and then throws,
where `io` retains precedence; and a callable proxy whose single throwing apply trap normalizes to
raw-free `io`.

The valid-descriptor abort oracle also confirms the intended checkpoint count: the pre-signal is
sampled once before IO capture, not sampled again after a descriptor trap. The API reviewer further
poisoned the live `node:fs/promises` default object's `lstat` binding after module import; the
captured default binding still succeeded with zero poison calls. A real symbolic-link fixture
independently returned `metadata.kind === "symbolic-link"`, confirming default no-follow behavior.

The adversarial reviewer added nine separate tests. Combined with the nine authored focused tests,
all 18 of 18 passed on each of the same three Node versions. The hostile matrix covered the fixed
priority order, hostile thenables, invalid and aborted post-samples over both settlement paths,
bigint metadata for every file kind, adapter and captured-intrinsic mutation, raw-free failures,
the non-authority boundary, and package export isolation. Its fresh complete check included the
extra oracle file and passed 36 files and 434 tests. The API review's four private tests were run
separately and are not included in either the authored focused count or the repository's 35-file,
425-test complete gate.

Production dependency audit reported zero vulnerabilities. A bare `npm pack --json` ran prepack
and its build successfully, producing 159 files, a 105,686-byte tarball, and 531,772 unpacked bytes.
An independently installed consumer made four runtime assertions: the package-root object lacked
the function name and both exported type-name keys, while importing the internal subpath failed
with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Verification

The frozen candidate is based on
`d4872d4e25a60346d2b277ba16cfc3b3f37131a4`. Its implementation SHA-256 is
`a145ff2a5559d9a78f72f0cc3f6e9ae7e6713738a3e83da925c7d6f4d60d55a0`, and its focused-test
SHA-256 is `62172852f808abb9aa00ed28e26d62e322f3d08a2405000ad16dcaec032bd754`.

The authored focused verification passes nine tests. The complete candidate check passes 35 test
files and 425 tests with 97.17% statement, 95.47% branch, 99.68% function, and 97.62% line
coverage. The new resource-tree-lstat module reaches 98.14% statements, 96.29% branches, 100%
functions, and 97.82% lines. Formatting, lint, generated-file freshness, type checking, coverage
thresholds, and `git diff --check` all pass for this pre-commit candidate.
