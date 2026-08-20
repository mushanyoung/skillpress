# Review 009q0d: captured apply receivers

- Slice: `fix: capture intrinsic apply receivers`
- Review: independent API, release, static, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `2427f67e97362ede2201355db3d716aed9dded94`
- Final result: PASS

## Scope and contract

This internal-only slice hardens eight existing modules without adding or exporting an API. It
replaces 24 live receivers passed to captured `Reflect.apply`: 19 `Object` receivers, three
`Array` receivers, and two `Number` receivers. The twenty-fifth site replaces skill-root's direct
runtime `Reflect.get` with captured apply, a captured `Reflect.get`, and a captured `Reflect`
receiver. Method targets, arguments, order, catches, await boundaries, result shapes, diagnostic
priority, freezing, and hidden-`then` barriers are unchanged.

Fourteen eager module-initialization references support those sites: one `Object` reference in
each of the eight modules; `Array` and `Number` references in both directory-name-index and
resource-tree-comparison; and `Reflect` plus `Reflect.get` references in skill-root. The exact
runtime-site distribution is:

| Module | Sites |
| --- | ---: |
| `abort-signal.ts` | Object 1 |
| `directory-name-index.ts` | Object 3, Array 1, Number 1 |
| `directory-read.ts` | Object 2 |
| `markdown-destination.ts` | Object 1 |
| `resource-tree-capture.ts` | Object 3 |
| `resource-tree-comparison.ts` | Object 7, Array 2, Number 1 |
| `resource-tree-lstat.ts` | Object 1 |
| `skill-root.ts` | Object 1, Reflect 1 |

Module initialization remains the trust boundary. The guarantee is narrow: replacing the five
tested globals after these modules initialize cannot redirect the affected receiver positions.
It makes no pre-import pollution claim. Captured `Reflect.get` preserves normal proxy getter and
trap semantics, and this slice does not remove q0c's proxy trap-return descriptor-normalization
boundary. Legacy validator, create, and CLI paths that still call globals directly remain outside
scope, so this is not package-wide intrinsic hardening.

## Authored verification

The new 183-line built-dist test uses two fresh child processes. Before pollution, each child
imports its modules and creates all fixtures, genuine document state, components, and signals.
It then installs throwing getters and setters for global `Object`, `Array`, `Number`, `Reflect`,
and `String`; both five-slot arrays, all ten scalar counters, remain zero.

The synchronous child verifies an active abort signal, a two-component local Markdown
destination, genuine directory-name indexing and reprofiling, `-0` rejection, and a structural
invalid input. The real-filesystem child verifies root success, missing-root diagnosis through a
prebuilt inert sink, two resource-tree captures, semantic equality, session open and currentness,
and exact path-index resolution. Assertions and fixture cleanup run only after the globals are
restored.

The authored selection passes one file and two tests. The expanded focused selection passes 14
files and 117 tests: the new test, the prior descriptor-barrier test, and the focused abort,
directory-name-index, reprofile, directory-read, capture, capture-IO, capture-mapping,
capture-non-thenable, comparison, lstat, destination, and root suites. Every changed module
exceeds 90% statements and branches:

| Module | S | B | F | L |
| --- | ---: | ---: | ---: | ---: |
| `abort-signal.ts` | 95.83 | 93.75 | 100 | 100 |
| `directory-name-index.ts` | 96.55 | 91.33 | 100 | 97.02 |
| `directory-read.ts` | 94.17 | 90.19 | 100 | 96.17 |
| `markdown-destination.ts` | 100 | 100 | 100 | 100 |
| `resource-tree-capture.ts` | 93.63 | 91.47 | 100 | 97.82 |
| `resource-tree-comparison.ts` | 93.63 | 93.36 | 100 | 98.83 |
| `resource-tree-lstat.ts` | 98.18 | 96.29 | 100 | 97.87 |
| `skill-root.ts` | 100 | 97.72 | 100 | 100 |

Formatting, lint, type checking, build, focused execution, coverage, and `git diff --check` pass.
The eight production files have numstat +59/-37, exactly 96 lines of churn; the paired test has
183 lines.

## API and release review

The API reviewer reconstructed and hash-checked the candidate in private space and returned PASS
with zero blockers. The complete test and check gates passed 47 files and 487 tests; format and
lint each checked 105 files. Global coverage was 96.08% statements, 94.73% branches, 99.78%
functions, and 97.45% lines. Node.js 22.23.2, 24.19.0, and 26.7.0 each passed the authored 2/2
selection.

Copying the authored test onto the pure base produced the expected 2/2 failures: the synchronous
case reached the old live destination receiver, while the tree case observed five `Object` and
two `Array` global reads. A separate 793-byte ordinary-behavior record was byte-identical between
base and candidate, with SHA-256
`19dc2c514f3bb6a92ddeff77d80a917677f0b81cba2f6213629feb15d08b4e3b`.

Root distribution JavaScript and declarations were byte-identical to base, with SHA-256
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63` and
`204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`, respectively; all 43
emitted declaration files were unchanged. The installed consumer retained exactly 18 root
runtime exports, passed its TypeScript compile, and received `ERR_PACKAGE_PATH_NOT_EXPORTED` for
the tested session and directory-name-index internal subpaths.

Dependency audit reported zero vulnerabilities. Bare `npm pack --json` ran prepack/build and
produced 179 entries, 139,086 packed bytes, and 726,066 unpacked bytes. Its npm tarball SHA-1
`shasum` was `43a104fac01937cd5ba67ece45c807ea24b3cfc6`; the tarball SHA-256 was
`2412274cf3b838221c1d963d219b8c545ba490e5fb1b428656c8b9ad5edeaf1e`.

During preparation of the pure-base negative check, this reviewer mistakenly ran
`npm ci --ignore-scripts` and `npm run build` in the shared workspace. Those commands may have
rebuilt ignored `node_modules` and `dist` content. Immediate checks showed unchanged HEAD,
tracked status, `git diff --check`, and all nine frozen SHA-256 values, with no new tracked
changes. All subsequent gates ran in private space; this lane is therefore not described as
having zero shared npm activity or zero possible ignored-file writes.

## Adversarial review

The adversarial reviewer independently reconstructed the candidate and returned PASS with zero
blockers. Its one-test private oracle has SHA-256
`a2d020a299e055e6e4c82a90e36e6642d90808cdb28bf98b0c6b6190aa80f8f3`. It independently checked
all five throwing global getter/setter pairs; a nested `docs/guide.md` real-filesystem capture,
comparison, session, currentness, and resolve chain; exact missing-root diagnosis; DNI `-0`
rejection; lstat and capture IO failures; exact success/failure/session/current barriers; and an
invalid success-versus-malformed comparison.

Authored plus private passed two files and three tests. The tracked complete gate remained
47/487, while the complete gate with the private test passed 48/488. Global coverage was 96.08%
statements, 94.73% branches, 99.78% functions, and 97.45% lines. The combined 2/3 selection passed
on Node.js 22.23.2, 24.19.0, and 26.7.0. Audit again reported zero vulnerabilities, and bare pack
reproduced 179 entries, 139,086 packed bytes, 726,066 unpacked bytes, and npm SHA-1
`43a104fac01937cd5ba67ece45c807ea24b3cfc6`.

The installed consumer retained exactly 18 runtime exports. `objectRef`, `arrayRef`, `numberRef`,
`reflectRef`, and `reflectGetSnapshot` were absent from both root runtime and declaration
surfaces. Exact imports of the internal skill-root, resource-tree-comparison, and
directory-name-index subpaths each returned `ERR_PACKAGE_PATH_NOT_EXPORTED`. This adversarial
lane performed zero shared-workspace writes and ran zero shared npm commands.

## Frozen files

- `src/validate/abort-signal.ts`: `439e321cb3787b3ae9dbbd54bc94411995603316e77ce6e3d120714e522d01c6`
- `src/validate/directory-name-index.ts`: `2320071093f21ceca984544996c7b55379541844eabf1879481c56e54d9b31e7`
- `src/validate/directory-read.ts`: `1799ac8728f5e77b33c69890230baed89790e9dc8e7d7101847d0f8e0c146b36`
- `src/validate/markdown-destination.ts`: `48a8f693fe433dd865697a108f98076a94709fc3ceb5719108c9343c46eafeef`
- `src/validate/resource-tree-capture.ts`: `014af5e0302e7bd764862f620d1663cdfa457db501e0aa3f699b2513b43311fd`
- `src/validate/resource-tree-comparison.ts`: `b60ab23b958681fa8fef7e33d8da5af67b1da6cc7844bd96b87c26825bb4b29b`
- `src/validate/resource-tree-lstat.ts`: `b1732b1cec8e3750bb65c7e4b9b382b91b990e3b0b6e260de165a0f48b7893a7`
- `src/validate/skill-root.ts`: `6724436136f7338ed32dd3ba4329874c8a06d83df5c4565b7ee485200893d0f2`
- `test/captured-apply-receivers.test.ts`: `e6f143ca9c335dda5ba018ad6a2a7301db15327c336e58eabd9dc716a9d0a437`

Only these frozen implementation/test paths differ from the base. This later review record
changes none of them and adds no root export, subpath, API, schema, configuration, IO, or
authority.
