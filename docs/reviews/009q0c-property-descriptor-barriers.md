# Review 009q0c: system property-descriptor barriers

- Slice: `fix: harden captured define-property descriptors`
- Review: independent API, release, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `2ac97e7639c4b628f7a1756c3d1d4bddc43e0dac`
- Final result: PASS

## Scope and contract

This slice changes ten internal production modules without adding an API. Eleven ordinary
descriptor literals passed to captured `Object.defineProperty` now have `__proto__: null`; their
receivers, field values, order, enumerability, writability, configurability, freezing, failure
priority, and result shape are unchanged. The sites cover lexical and destination array appends,
root and directory projections, capture and session barriers, comparison tokens, file-read
barriers, and path-index projection.

`indexDirectoryNames` also stops reading `descriptor.get`, `descriptor.set`, and
`descriptor.value` directly. It obtains an own descriptor for `value`; only an existing own data
value is accepted. A missing value, including an empty accessor descriptor, remains
`invalid_input` without invoking a caller getter or an inherited `value` accessor.

Module initialization remains the trust boundary. The guarantee concerns pollution installed
after the affected modules capture their producers and intrinsics; it does not claim safety from
pre-import replacement. Captured `Object.getOwnPropertyDescriptor` can still invoke a proxy's
descriptor trap, so this normalization neither makes proxies trap-free nor proves provenance or
authority. For a proxy receiver, normalization of the trap-returned descriptor may itself consult
inherited `get`, `set`, or `value` fields before the captured call returns; the zero-poison
guarantee therefore excludes proxy-backed inputs or receivers. Captured-intrinsic receiver
hardening is the separate planned 009q0d slice and is not implemented or claimed here.

## Authored verification

The new 180-line test contains two fresh child-process cases against built `dist` modules. The
first installs Object-prototype `get`, `set`, and `value` accessors after import and verifies a q0a
control projection, a two-component local destination, a genuine directory-name index, and an
empty accessor slot rejected as `invalid_input`, all with zero poison calls. The second obtains a
genuine document before pollution, then verifies root inspection, two captures, semantic
comparison, session open/currentness/member read, and path-index build/resolve. Representative
capture and session early failures retain their frozen hidden-`then` barriers. All eleven runtime
sites are exercised with zero poison calls.

The authored child/dist selection passes one file and two tests. The expanded targeted coverage
selection passes 16 files and 165 tests. Overall coverage is 95.43% statements, 94.23% branches,
100% functions, and 97.41% lines. Every changed module reaches at least 90% statements and
branches:

| Module | S | B | F | L |
| --- | ---: | ---: | ---: | ---: |
| `skill-source.ts` | 98.95 | 96.77 | 100 | 100 |
| `markdown-destination.ts` | 100 | 100 | 100 | 100 |
| `skill-root.ts` | 100 | 97.72 | 100 | 100 |
| `directory-read.ts` | 94.14 | 90.19 | 100 | 96.15 |
| `directory-name-index.ts` | 96.51 | 91.33 | 100 | 96.99 |
| `resource-tree-capture.ts` | 93.60 | 91.47 | 100 | 97.81 |
| `resource-tree-comparison.ts` | 93.54 | 93.36 | 100 | 98.81 |
| `resource-tree-session.ts` | 94.38 | 97.67 | 100 | 94.36 |
| `file-read.ts` | 100 | 100 | 100 | 100 |
| `resource-tree-path-index.ts` | 92.46 | 90.58 | 100 | 96.92 |

Formatting, lint, type checking, build, focused execution, coverage, and `git diff --check` pass.
The production numstat is +27/-13, exactly 40 changed lines.

## API and release review

The API reviewer reconstructed the exact candidate in private space and returned PASS with zero
blockers. The authored child test passed 2/2. Both `npm test` and the complete `npm run check`
passed 46 files and 485 tests; format and lint each checked 104 files. Global coverage was 96.06%
statements, 94.73% branches, 99.78% functions, and 97.44% lines. Node.js 22.23.2, 24.19.0, and
26.7.0 each passed the authored 2/2 selection.

Copying the same revised authored test onto the pure base produced the expected 2/2 failures: the
synchronous case exposed the old skill-source mixed data/accessor-descriptor `TypeError`, and the
complete tree case recorded 14 poison calls. A separate DNI priority oracle checked an empty
accessor first, an own data `undefined` first, and a valid data slot followed by an empty accessor;
all returned `invalid_input` with zero caller-getter and prototype-poison observations. A
representative 1,790-byte base/candidate JSON record covering success, failure, barrier, and root
outcomes was byte-identical.

Root distribution JavaScript, declarations, and the 18-name runtime surface remained unchanged.
Dependency audit reported zero vulnerabilities. Bare `npm pack --json` ran prepack/build and
produced 179 entries, 138,951 packed bytes, and 725,165 unpacked bytes; its npm tarball SHA-1
`shasum` was `c9429b11ff9bef915977faed21e9787a4db0fed9`. The installed consumer retained all 18 root
exports and blocked the tested internal subpaths.

## Adversarial review

The adversarial reviewer independently reconstructed the candidate and returned PASS with zero
blockers. Its one-test private oracle has SHA-256
`19162482dd9108a389d74ff6ce59684a63b3a3b6af3d2d7cd6d0287d7b808a80`. It independently covered
the synchronous projections, DNI empty-accessor normalization, and a runtime file-read
`invalid-metadata` result with its exact frozen barrier. The private case observed zero poison or
context callbacks.

Authored plus private passed two files and three tests; the tracked complete gate remained 46/485,
while the complete gate with the private file passed 47/486. The combined 2/3 selection passed on
Node.js 22.23.2, 24.19.0, and 26.7.0. Audit again reported zero vulnerabilities, and bare pack
reproduced 179 entries, 138,951 packed bytes, and 725,165 unpacked bytes.

The installed consumer retained exactly 18 runtime exports. These nine internal names were absent
from both root runtime and declaration surfaces: `projectSkillDocumentEnvelope`,
`classifyMarkdownDestination`, `indexDirectoryNames`, `captureInspectedResourceTree`,
`compareResourceTreeCaptureSemantics`, `openInspectedResourceTreeSession`,
`readInspectedUtf8File`, `createResourceTreePathIndex`, and `inspectAgentSkillRoot`. Exact imports
of the internal session and directory-name-index subpaths both returned
`ERR_PACKAGE_PATH_NOT_EXPORTED`. Both review lanes performed zero shared-workspace writes and ran
zero shared npm commands.

## Frozen files

- `src/validate/skill-source.ts`: `9218e3e59e63f7d5751c21df9aec21d8ba75cc526f4d7e2346af326311be834b`
- `src/validate/markdown-destination.ts`: `0d2be35cf838f023235c599f40b754d1b917d6af214b974f9e6f6ba3d875c9d6`
- `src/validate/skill-root.ts`: `d71436b2bec35ec7c87228c0a4cfd6e7a5fe1727f96d01a3312ced1b7274f896`
- `src/validate/directory-read.ts`: `081f9f258910833ee07b38ec36cab64b8c13eb06c3b4f5224e1267b5f3f20943`
- `src/validate/directory-name-index.ts`: `9669659e0b46a7dee26b98e90b89f546b1bbc334b31c54440a8d6343c3bb1e62`
- `src/validate/resource-tree-capture.ts`: `9005b931fa43fb45178c8e2e8cceaa0b279104228983a5bf01521169565d8e8c`
- `src/validate/resource-tree-comparison.ts`: `75abd9c765c9c3698f82f6ce4f7bb9da82bba43058bc4cd4a2b0e101821fc173`
- `src/validate/resource-tree-session.ts`: `330ca9f530ae93510933020b2cdebf7086432da45d997de2166d35c6ac6e076c`
- `src/validate/file-read.ts`: `2037bde660a45a6018b869874607443f41812027b281968ae380ec328ef70593`
- `src/validate/resource-tree-path-index.ts`: `75ac3e8693665656bd2d49f21235f2b75aa061dabcf7b572d7d84807ed9d2b0e`
- `test/property-descriptor-barriers.test.ts`: `75ffbbd0cb326e16bdd4f6e6dca954f8d0d5a0bb74fa0fdade2e65e86d3d126e`

Only these frozen implementation/test paths differ from the base. This later review record changes
none of them and adds no root export, subpath, API, schema, configuration, IO, or authority.
