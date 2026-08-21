# Review 009y: remove resource-name RegExp retention

- Slice: `resource-name reserved-key matcher`
- Review: independent security, adversarial, compatibility, and release reviews
- Date: 2026-08-20
- Frozen base: `dc41d500dcbbe0e952a45c4954ff1b1449438be2`
- Released candidate: `eccd69f0f2b599aac8195a244499609528373724`
- Final result: `009y delta: PASS`

This is a later docs-only record. It was not present in the verified package and changes neither of
the two frozen candidate paths.

## P0 and scope

`resource-name-profile.ts` captured `RegExp.prototype.exec`, but a successful execution of its
Windows reserved-name expression still wrote the complete folded resource key into V8's legacy
RegExp state. A benign nine-group seed followed by a reserved name changed all 19 canonical and
alias observations: `input`, `$_`, `lastMatch`, `$&`, `lastParen`, `$+`, `leftContext`, `` $` ``,
`rightContext`, `$'`, and `$1` through `$9`. Node.js 22, 24, and 26 reproduced the leak. The returned
frozen `nonportable` singleton was raw-free, but that did not clear or compensate for the runtime
retention channel.

The 009y delta replaces only that per-input matcher. It changes no exported type, result shape,
reason, brand, limit, validation order, package-root export, schema, CLI, graph, or session behavior.
`unicode-portability.ts` still has its existing import-time expression for parsing the public
`process.versions.unicode` value; profiling an individual resource name now performs zero RegExp
execution. Separate path and destination retention work remains deferred to 009z and 010a.

## Exact manual matcher

The existing pinned Unicode 15.1 full-fold projection remains the sole key authority. The manual
matcher reads that folded key through the already-captured `String.prototype.charCodeAt` and
`Reflect.apply`; it does not introduce host casing, normalization, `startsWith`, slicing, an array
iterator, or another Unicode authority.

The accepted reserved language is exactly:

- fixed stems `aux`, `con`, `nul`, and `prn`;
- literal-dollar stems `clock$`, `conin$`, and `conout$`; and
- `com` or `lpt` followed by exactly one ASCII digit `1` through `9`, or superscript `¹`, `²`, or
  `³`.

The recognized token must end at end-of-string or immediately before U+002E FULL STOP. Longer
special stems are checked before the shorter `con` branch, preserving the old alternation's
fallback behavior. Thus `con.txt`, `clock$.txt`, and `com¹.txt` remain reserved, while `console`,
`conin`, `conout`, `clock`, `com10`, `com¹0`, and `lpt³x` remain safe. Existing forbidden-character,
trailing-space, trailing-dot, UTF-8 byte, separator, Unicode, and failure-priority checks are
unchanged.

## Authored verification

The paired test covers every fixed stem at end-of-string and before a suffix, both numeric stems
with all 12 accepted number code points, full-folded uppercase and Kelvin-sign inputs, and targeted
near misses. A separate deterministic corpus compares the implementation with the exact removed
expression without entering the retention oracle.

For representatives covering every matcher control-flow branch, the retention oracle statically
imports the module, seeds a benign nine-group match, snapshots all 19 legacy observations,
classifies the secret-bearing name, and immediately snapshots again. No expression or assertion
runs inside the before/classify/after window. Results are the same frozen, genuine colon-derived
`nonportable` singleton and contain no secret. Post-import replacements of both
`RegExp.prototype.exec` and `.test` are ignored, and a source audit locks zero `RegExp`, `.exec`, or
`.test` use in `resource-name-profile.ts`.

Targeted formatting and lint, strict TypeScript, the focused file, and focused coverage passed in
the shared author lane. The frozen artifacts are:

- `src/validate/resource-name-profile.ts` — 275 lines —
  `280297587f7b2e17fd80d3e5a93032d4e12cd7bd336d4d1495d61ef8c8dfac03`; and
- `test/resource-name-profile.test.ts` — 630 lines —
  `7d564a787139b0838479f1697c4c19c12d8e4384f28da8d588b511f1cc4e5c63`.

Relative to the base, production grows by 32 lines, tests by 89, and the total by 121.

## Detached release and coverage

The detached candidate cold-installed 122 packages. Node.js 22.23.2, 24.19.0, and 26.7.0 each
passed the focused one-file/14-test selection and the full 52-file/687-test suite. Node 26 passed
complete `npm run check`; format and lint covered 114 files, and generated-file and type checks
passed. Full and production-only audits reported zero vulnerabilities.

Global coverage is 95.78% statements, 94.58% branches, 99.82% functions, and 97.38% lines.
`resource-name-profile.ts` is 100% statements, 99.02% branches, 100% functions, and 100% lines.

The independent 50-line release oracle has SHA-256
`99760e39b9f421409c206fcac3615be61992911839814accbdf98b6b76c70ff4`. It passed the 19-alias
retention check on all three supported Node versions.

## Pack, consumer, and dist

Dry and actual packing agree: 195 entries, 170,235 packed bytes, and 902,332 unpacked bytes. The npm
SHA-1 is `80131e96338c599173c8b88436a9c062301d9b4e`, tarball SHA-256 is
`fcc22d2843e391a79ecc0a42ffed0b715c1abceb85762b021d70071386f94657`, and integrity is
`sha512-Wr8zFQfLpcjHJF0iTRBb1fr35N1UxgYViDz/qRS4gQjsvEDXhKxhT0eRKQ4iymAkGR+NrXU4Ldk42bJP2G2L/Q==`.

The isolated consumer added 41 packages and audited with zero vulnerabilities. Node 18.20.8,
22.23.2, 24.19.0, and 26.7.0 expose the same 18 root runtime names. Six tested internal paths remain
blocked with `ERR_PACKAGE_PATH_NOT_EXPORTED`; CLI version/help behavior is unchanged. Strict
NodeNext TypeScript passes against the root declarations, while internal imports fail with
`TS2307`.

Fresh base and candidate builds each contain 188 regular dist files, three directories, and zero
special files. No path is added or removed and 185 files are byte-identical. Only
`validate/resource-name-profile.js`, its source map, and its declaration map change; package-root
JavaScript and declarations remain byte-identical.

## Property and private adversarial holdouts

The external property repository remained clean at
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. On all tested Node versions its public report SHA-256
remains `b78fa593ecf98ccc2b51aec95f683cc6cd112a4ce1f20608a3d161660a7c76a1`, with only the existing
license warning. Its complete four-document graph retains three root edges at line 12, columns 6,
108, and 201; totals remain four files, 59,712 bytes, 1,872 nodes, three targets, 20 work units, six
components, and zero aliases. Graph, resource, and placeholder findings remain empty.

The private adversarial oracle at
`/private/tmp/skillpress-009y-adversarial.XMq87v/oracle.mjs` is 263 lines with SHA-256
`005e709df21e72e71db88ac899e456611a84c3a7d658249ad8b4e1c3c8e580ad`. Its isolated package and
real `node_modules` exercised 218,685 differential inputs per Node, or 656,055 across Node 22, 24,
and 26, with zero mismatch. It also checked 11 reserved branches against all 19 legacy aliases,
observed zero post-import RegExp pollution calls, and reproduced the unchanged property report and
graph on every version. The stable graph-summary SHA-256 is
`4a2438e2fc699e12dff38c6b3f8758dc596a20d86a1b2f05b5ba059d679f84c8`.

## Harness record

One review command initially used the wrong detached-checkout working directory and exited 128; it
was rerun from the correct candidate directory. An audit agent reached the collaboration spawn
limit; that was orchestration state, not a product or release-harness failure. Neither incident
changed a result. Apart from this authorized later docs-only record, the review, audit, and detached
release harnesses performed no npm command or write in the shared checkout. The shared candidate
and property repository finished clean.
