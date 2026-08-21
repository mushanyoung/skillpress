# Review 009z: remove path-safety RegExp retention

- Slice: `path-safety per-input RegExp removal`
- Review: independent security, adversarial, compatibility, and release reviews
- Date: 2026-08-20
- Frozen base: `2e4dd3827e5f31e189e2daf70c0d314ce37f281d`
- Released candidate: `44299d959d9d28307364df14fc95b5a832d6c3d5`
- Final result: `009z delta: PASS`

This is a later docs-only record. It was not present in the verified package and changes neither
the frozen candidate nor its package contents.

## P0 and scope

`path-safety.ts` captured `RegExp.prototype.exec`, but successful executions still wrote caller path
text or a component into V8's legacy RegExp state. The host default-ignorable expression retained
the complete Unicode input. The Windows device-prefix, drive-relative, forbidden-component, and
reserved-name expressions retained raw path or component text. Even an accepted absolute drive
path such as `C:\safe\sentinel` changed the state when the drive-component expression matched
`C:`. A benign nine-group seed demonstrated changes across all 19 canonical and alias observations.
Captured execution protected integrity, not confidentiality.

The 009z delta removes only per-input RegExp execution from the two existing path-safety
predicates. It changes no signature, export, limit, boolean result, platform default, caller,
diagnostic, CLI, schema, graph, or session behavior. Path safety remains internal at the package
root, and tested deep imports remain blocked. Markdown-destination retention remains separate 010a
work.

## Exact replacement

`isUnambiguousUnicode` now snapshots and calls the generated Unicode 15.1
`isDefaultIgnorableCodePointUnicode15_1` predicate during its existing code-point scan. The UTF-8
round trip, control ranges, line separators, noncharacters, 64 KiB UTF-8 and cheap UTF-16 bounds,
blank check, and evaluation order are unchanged.

Windows checks are five explicit code-unit grammars:

- two identical leading separators, `?` or `.`, then either separator for device prefixes;
- an ASCII drive letter and colon followed by end-of-string or a non-separator for drive-relative
  paths;
- an exact ASCII letter-plus-colon first component for accepted absolute drives;
- the exact component characters `<`, `>`, `"`, `|`, `?`, and `*`, with the existing separate colon
  rule; and
- DOS reserved names: `aux`, `clock$`, `con`, `conin$`, `conout$`, `nul`, `prn`, or `com`/`lpt`
  followed by one of `1`–`9`, `¹`, `²`, or `³`, terminated by component end or U+002E.

Reserved-name comparison implements the old `/iu` language with ASCII case folding and the only
additional relevant scalar fold, U+212A KELVIN SIGN to `k`. Components are scanned in their original
path intervals without slicing, live casing, iteration, or a new Unicode authority. The primitive
still does not enforce `MAX_PATH_COMPONENTS`; that existing budget belongs to `skill-root`.

## Authored verification and frozen artifacts

The paired suite compares 1,112 deterministic inputs against the five exact removed Windows
expressions, including all eight device-prefix separator/marker combinations, every reserved
branch, ASCII case, Kelvin, superscript digits, structural components, and near misses. It checks
all 4,174 pinned default-ignorable code points, exact and over-limit ASCII/multibyte paths, and 257
components without adding a primitive cap.

Seven former execution paths use a nine-group benign seed and immediate 19-slot snapshots around
the candidate call, with no RegExp execution or test assertion in that window. They cover direct
and Linux default-ignorable input, device prefix, drive-relative, accepted drive component,
forbidden component, and reserved component. Post-import RegExp, String RegExp-entry, and casing
poison is inert. A source oracle locks zero RegExp execution and zero String RegExp-entry calls in
production.

Frozen artifacts:

- `src/path-safety.ts` — 215 lines —
  `76e6ce948c79e97ef71fd5ee94d3fe6c4b569b2a2c5d50379ca7a97a3bcfeaf0`; and
- `test/path-safety.test.ts` — 342 lines —
  `507a487e6003aaea6373df8b90a22b611d7856cffa490c8539c4dae2540fd2d4`.

Production grows by 99 lines, tests by 224, and the combined delta is 323 lines.

## Shared and detached verification

Targeted formatting, lint, strict TypeScript, focused execution, and focused module coverage passed.
The complete shared check passed 52 files and 692 tests; format and lint covered 114 files, and
generated-file and type checks passed. Global coverage is 95.81% statements (4,962/5,179), 94.67%
branches (3,607/3,810), 99.82% functions (571/572), and 97.40% lines (4,458/4,577).
`path-safety.ts` is 100% statements (88/88), branches (117/117), functions (17/17), and lines
(74/74). Full and production-only audits reported zero vulnerabilities.

## Canonical package, consumer, and dist

The canonical Homebrew Node 26.7.0/npm 11.19.0/zlib 1.2.12 package has 195 entries, 170,641 packed
bytes, and 907,866 unpacked bytes. Its npm SHA-1 is
`a8a41c8e73e16ebee7d5061604dee2e4f683f40c`, tarball SHA-256 is
`2632e0a95a3515447e1eb1c0ffd6b80a442a7c59d6194a5ecd72f4593afd6ecb`, and integrity is
`sha512-lOvMc+CHqNe2xX5pOxw91YPGbsfDnIJZRRKO7no7VbYuEiSxI/1CT1iIhDfvek09jBksUOTbn9l0QelpjKfpsQ==`.

The isolated consumer added 41 packages and audited with zero vulnerabilities. Node 18.20.8,
22.23.2, 24.19.0, and 26.7.0 expose the same 18 root runtime names; six internal imports remain
blocked with `ERR_PACKAGE_PATH_NOT_EXPORTED`. CLI version `0.1.0` and help behavior are unchanged.
Strict NodeNext TypeScript passes against the root declarations, while the internal import fails
with `TS2307`.

Fresh base and candidate builds each contain 188 regular dist files, three directories, and zero
special files. No path is added or removed, and 185 files are byte-identical. Only
`path-safety.d.ts.map`, `path-safety.js`, and `path-safety.js.map` change; package-root JavaScript and
declarations remain byte-identical.

## Property and private adversarial holdout

The external property repository remained clean at
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. Across Node 22, 24, and 26 its public report remains
`b78fa593ecf98ccc2b51aec95f683cc6cd112a4ce1f20608a3d161660a7c76a1`, with only the existing
license warning. Its complete four-document graph retains three line-12 root edges, totals of four
files, 59,712 bytes, 1,872 nodes, three targets, 20 work units, six components, and zero aliases,
with empty graph, resource, and placeholder findings. The stable graph-summary SHA-256 is
`4a2438e2fc699e12dff38c6b3f8758dc596a20d86a1b2f05b5ba059d679f84c8`.

The self-contained oracle at `/private/tmp/skillpress-009z-adversarial.jpQPrN/oracle.mjs` is 389
lines with SHA-256 `43500be55d5f3fabd2eed7e01cf09cb1eb7a2e214965c7c3a0df6fc389659e4f`.
Across Node 22, 24, and 26 it runs 895,236 broad Windows differential cases and 3,336,192 Unicode
scalar cases with zero mismatch. Pinned and host default-ignorable counts are both 4,174 with zero
difference. Seventeen former execution cases preserve all 19 legacy slots, and post-import RegExp
and casing pollution records zero calls. The candidate clone, shared checkout, and property
repository finish clean.

## Harness record

An audit lane's initial alternate run combined mise Node 26.7.0/zlib
`1.3.2.1-motley-42c2f19` with npm 12.0.2 and produced a 170,872-byte tarball with SHA-1
`b72b4f8d96daba65262f4d7153a9c27f3c90c09b` and SHA-256
`59a15ee327306424b5109489b3d74a5c265975b1712e40ff343a2aaeede47ef1`. Repeating that run with
npm 11.19.0 reproduced the alternate archive, isolating the difference to the Node-linked
zlib/deflate toolchain rather than npm. Both gzip headers agree, and their decompressed tar streams
are byte-identical with SHA-256 `6a6a4cbda814a1a45fb074b7b262eaf2115fc313d0b2d31dc3f51ffaf3914f14`;
the common payload-manifest SHA-256 is
`3771896494c286e1968eaaaad0d85ed84f05e931bbd312ff72d7d3b290c4b750`. The alternate archive is
not a candidate failure.

The first consumer command was rejected before process startup because its intended working
directory had not yet been created; the lane created it separately and reran. A handwritten runtime
oracle initially reversed the expected ordering of the `CONFIG` and `Capability` exports, so its
first Node 22 run alone failed. After correcting the oracle, Node 18, 22, 24, and 26 all passed.
Apart from this authorized later docs-only record, the private adversarial holdout used its own
clone, package, and cache and performed no npm command or write in the shared checkout.
