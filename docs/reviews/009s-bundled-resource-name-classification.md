# Review 009s: classify bundled resource filenames

- Slice: `feat: classify credential-like resource names`
- Review: independent contract, adversarial, and release reviews
- Date: 2026-08-20
- Frozen base: `4aedeb1f515781558f79793a89b0db0a0b1faef2`
- Final result: PASS

## Scope

This slice adds one internal, synchronous filename classifier and its paired unit test. It does not
integrate the classifier into public validation yet. It does not change the validator, CLI, README,
configuration, schemas, public TypeScript types, package root exports, or package export map, and it
performs no filesystem, network, async, callback, or content operation.

The classifier accepts one inert observed basename. It does not accept a path, entry, tree, file
kind, session, or read capability, and it grants no authority over any of them. A later integration
slice must call it only for regular resource-file entries from the Markdown graph's retained B
inventory. That integration must remain inside the same resource-tree transaction; a second tree
walk or a scan of only `reachableFiles` would miss unlinked files and split the safety observation
from reference validation.

The internal result union is exactly one of:

- `{ ok: true }`;
- `{ ok: false, reason: "invalid_input" }`;
- `{ ok: false, reason: "environment_file" }`;
- `{ ok: false, reason: "credential_file" }`.

Every outcome is a recursively frozen singleton registered in a private `WeakSet`. The exported
provenance predicate checks only identity and never inspects candidate properties. Results contain
no basename, match, suffix, source text, path, error, or cause.

## Classification contract

For a basename already accepted by the captured profile, matching folds only ASCII `A-Z` to
`a-z`; it does not use locale or Unicode case folding. Environment classification has priority over
credential classification.

| Family | Fixed rule |
| --- | --- |
| Environment | exact `.env`, or prefix `.env.` |
| Credential exact | `.netrc`, `.npmrc`, `.pypirc`, `.envrc`, `.git-credentials`, `credentials`, `credentials.json`, `id_dsa`, `id_ed25519`, `id_rsa`, `service-account.json`, `secrets.json`, `token.json` |
| Credential suffix | `.key`, `.p12`, `.pem`, `.pfx` |

Suffix matching is deliberately fail closed, so the basename `.pem` is credential-like. An
environment name such as `.ENV.PEM` remains an environment file. Near misses including
`.env-example`, `id_rsa.pub`, `credentials-guide.md`, `tokenization.json`, `certificate.pem.md`, and
`foo.pem.bak` remain safe. The long-s character in `ſecrets.json` is not treated as ASCII `s`.

The captured `profileObservedResourceName` producer and its genuine-result predicate establish the
semantic trust boundary. The predicate must return the primitive `true`. After that boundary, the
classifier observes `ok` and `exact` at most once each, requires a successful primitive string profile
bound to the original input, and applies a bounded code-unit guard before matching. Producer,
predicate, accessor, and matching exceptions all collapse to the fixed `invalid_input` singleton.
The classifier does not duplicate the producer's UTF-8, normalization, portability, proxy, or
Unicode-domain validation.

All intrinsics, producer functions, and predicate functions used at runtime are captured at module
initialization. ASCII comparison uses numeric loops and the captured `String.prototype.charCodeAt`;
it does not use regular expressions, iterators, locale transforms, or live prototype methods.

## Authored verification

The focused suite passes one file and 56 tests on Node.js 22.23.2, 24.19.0, and 26.7.0. It covers:

- both environment forms, all 13 exact credential names, all four credential suffixes, mixed ASCII
  case, environment priority, ordinary names, and the fixed near misses;
- invalid primitives, boxed strings, separators, dot names, control characters, unpaired Unicode,
  and the exact 255-byte and plus-one resource-name boundary;
- active and revoked proxies with zero traps, second-module brand rejection, cloned and forged
  results, singleton identity, frozen shapes, and absence of retained input;
- captured producer and predicate throws, non-boolean predicate results, unauthenticated profiles,
  hostile shapes, substituted values, and stateful getters whose `exact` field is observed once;
- post-import global-constructor pollution with zero observation.

The candidate module reaches 54/54 statements, 35/35 branches, 11/11 functions, and 45/45 lines.
The shared final `npm run check` passes formatting, lint with warnings as errors, generated-file
checks, type checking, build, and 50 files / 621 tests. Global coverage is 95.75% statements,
94.42% branches, 99.8% functions, and 97.32% lines.

## Independent release review

A fresh reconstruction from the frozen base matched both file hashes. Node.js 22.23.2 and 24.19.0
each pass the full 50-file / 621-test suite; Node.js 26.7.0 passes the complete `npm run check` gate.
Both the full dependency audit and `npm audit --omit=dev` report zero vulnerabilities. The cold
install added 122 packages and audited 123; npm only reported that it blocked the optional
`fsevents@2.3.3` install script.

The independent hostile oracle is 102 lines with SHA-256
`c2dc1cf4f7ff47886a3e299e0b931f0aad35a7ed9a1f26a6316235a5757b4e5c`. Its two tests pass on
Node.js 22.23.2. Direct post-import pollution of `Reflect.apply`,
`String.prototype.charCodeAt`, `Object.freeze`, and `WeakSet.prototype.add` and `.has` produces zero
calls, and active or revoked predicate proxies produce zero traps and the fixed invalid result.

Bare packing produces 191 entries, 159,768 packed bytes, and 840,515 unpacked bytes. The npm SHA-1
is `0f82317b3a6af105679dbc5112e4fed5195717bb`; the tarball SHA-256 is
`efb1baf267e615f01e59da874a6738658206a369d84d0dd3f72eee413cef4d86`. The package contains only
the four expected compiled classifier artifacts in addition to the base package; source and tests
are not packed.

A freshly installed consumer passes on all three Node versions. The root runtime still exposes
exactly 18 names and does not expose the classifier. Both tested internal subpaths fail at runtime with
`ERR_PACKAGE_PATH_NOT_EXPORTED`; the root TypeScript consumer compiles, while the internal import
fails with `TS2307`. Consumer installation audits 42 packages with zero vulnerabilities.

Relative to the clean base build, the candidate adds only
`bundled-resource-name.{js,js.map,d.ts,d.ts.map}`. `dist/index.js` and `dist/index.d.ts` remain
byte-identical to base, with SHA-256
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63` and
`204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`.

## Boundaries and review incidents

This slice recognizes conventional environment and credential-like filenames; it does not prove a
bundle contains no secret. It does not inspect content, renamed secrets, executability, archives,
caches, packaging provenance, or entropy. Public certificates with `.pem` or `.key` names are
intentionally rejected by the future fail-closed integration unless that policy is separately
changed. Existing resource-tree capture, not this classifier, remains responsible for rejecting
symlinks and special files.

Two earlier review candidates were rejected before freeze: the first accepted non-boolean truthy
predicate results and read hostile profile shapes outside `try`/`catch`; the second observed a
stateful `exact` getter more than once. Both defects were reproduced, fixed, and locked by authored
tests before the final release gates. Interim candidates `ff402d…` and `54b556…` ran green before
being replaced by the final trust-boundary comment and additional oracles; their results are not
counted as final evidence. One private reconstruction command omitted `git -C`; it produced only a
fatal error and an empty private temporary directory, then was rerun correctly. It did not touch the
shared repository or candidate.

## Frozen files

- `src/validate/bundled-resource-name.ts`:
  `7be748765069b32c67a1e7d4c13b52dc2f00d1e26f22fb2e4412e812a0c48516`
- `test/bundled-resource-name.test.ts`:
  `e105090ed051d23650d4c1ab4f8f60d13196b3edb857c0b2ec5c6dc30cff57f1`

The review record changes neither frozen file and adds no public export, validator behavior,
configuration, resource authority, read, or executable operation.
