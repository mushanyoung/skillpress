# Review 009w: surface Markdown placeholder diagnostics

- Slice: `feat: surface Markdown placeholder diagnostics`
- Review: independent contract, adversarial, compatibility, and release reviews
- Date: 2026-08-20
- Frozen base: `80472e127aa74172bdea7dedb5996981fbde4120`
- Released candidate: `c8c5f681fcebed9e827a63f36256edfe5f22f47c`
- Final result: PASS

This record is added by a later docs-only commit. It is not one of the seven candidate paths, was
not present during candidate verification, and is not contained in the released candidate's
195-entry tarball.

## Scope and authority

This B1 slice transports the already-reviewed Markdown-body placeholder observations from the
internal analyzer through the retained resource-graph transaction and maps them to public validator
diagnostics. It adds no parser, filesystem read, network access, execution authority, schema,
configuration, CLI argument, package export-map entry, or package-root runtime/declaration export.
`SKILL.md` YAML frontmatter remains excluded; frontmatter-field placeholder validation is reserved
for the later B2 slice.

Both successful graph-result variants now require an enumerable `placeholderFindings` field. Each
published item is exactly the raw-free projection `{ file, location }`; it retains no semantic text,
marker, target, URL, AST node, producer result, error, or cause. The inventory has an independent
module-private `WeakSet` brand exposed only through the internal
`isGenuineMarkdownResourcePlaceholderFindings` predicate. The array, items, locations, graph result,
and existing outer then barrier are frozen. Resource-name and placeholder inventories cannot be
substituted for one another.

The captured analyzer and exact-`true` genuine-analysis predicate remain the sole semantic
authority. After the post-predicate signal checkpoint and aggregate node-budget debit, the graph
copies only bounded own data: inventory length, dense slots, each own `location`, and its own `line`
and `column`, each read once. Inventory, item, and location proxies are rejected property-free;
accessors are never invoked. Foreign-realm, custom-prototype, and unfrozen containers remain valid
when their own-data shape is valid, so the transport adds no `Array.isArray`, prototype, or freeze
policy beyond the genuine parent authority.

Each inventory length must not exceed that analysis's `nodeCount`; line and column must be positive
safe integers no larger than source length plus one. The preexisting aggregate node limit therefore
bounds the published inventory to at most 100,000 entries without a new budget or work-unit charge.
Node-budget overflow and post-predicate cancellation both win before slot zero is inspected.

Findings use document-block DFS order: all observations from the current document are staged in
analysis source order before linked child subtrees are visited. Root-body locations receive the
frozen frontmatter line offset; nested Markdown locations remain file-local. Placeholder presence
does not change `graph.complete`. Graphless lexical success owns a genuine empty inventory even when
its uninterpreted text is `TODO`. Any malformed transport or graph/session failure returns only the
existing outer failure; final-current false, a valid final-current failure, or final replay mutation
publishes no staged inventory.

## Diagnostic and admission contract

Every observation maps to exactly:

```text
code:     skill.markdown.placeholder
severity: error
scope:    skillpress
message:  Markdown visible text must not contain placeholders
location: canonical graph file, line, and column only
```

The public validator parses and validates root frontmatter fields first, then validates both the
resource-name and placeholder inventory brands with literal `=== true`. It validates both brands
before calling either nested mapper. Resource-brand failure prevents even the placeholder predicate;
any absent, inherited, accessor-bearing, foreign, cloned, proxied, cross-branded, throwing, or
truthy-nonboolean result fails closed as the existing `skill.resources.read` diagnostic.

Admission order is root/frontmatter fields, resource-name findings, Markdown placeholder findings,
then graph/reference findings; final display order remains the collector's canonical sort. At the
256-entry cap, the frozen golden is two root errors plus one resource finding plus 252 placeholder
diagnostics, zero reference diagnostics, and one `skill.diagnostics.truncated` diagnostic.

## Authored and independent verification

The focused three-file selection passes 101 tests on Node.js 22.23.2, 24.19.0, and 26.7.0. It covers
genuine root and nested Markdown, root offsets, document-block DFS, exact output keys, graphless
`TODO`, completeness, deep freeze, raw absence, independent brands, clone/cross-brand rejection,
active and revoked proxy zero-trap behavior, foreign custom prototypes, every own-data accessor
layer, coordinate exact/plus-one bounds, inventory length versus node count, node/signal priority,
all three final-current no-publication outcomes, fixed mapping, public integration, two-brand mapper
gating, and the exact diagnostic cap. The existing hermetic property-tax-shaped fixture retains its
single license warning and exact graph golden.

All three Node versions pass the full 52-file / 684-test suite. Node 26 passes the complete
`npm run check`: format and lint each cover 114 files, generated-file checks and strict TypeScript
pass, and coverage is 95.78% statements (4,869/5,083), 94.47% branches (3,471/3,674), 99.81%
functions (554/555), and 97.39% lines (4,377/4,494). Relevant module coverage is:

| Module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `agent-skill.ts` | 100% | 98.66% | 100% | 100% |
| `markdown-resource-diagnostics.ts` | 97.05% | 98.55% | 100% | 96.93% |
| `markdown-resource-graph.ts` | 92.51% | 90.89% | 100% | 95.94% |

The full and production-only dependency audits both report zero vulnerabilities. Cold Node 26
installation added 122 packages. Its only install warning was the preexisting blocked optional
`fsevents@2.3.3` install script; it was not approved or executed.

## Pack and consumer verification

Dry and actual bare packing are byte-identical: 195 entries, 168,670 packed bytes, and 892,912
unpacked bytes. The npm SHA-1 is `79d3af51d40b66f9c14dceb455d717c6a8d2420f`, tarball SHA-256
is `655ef16d7063561ed14143c0ceed96a8b721a6d9c9ea8d950a76fdc6119f70d4`, and integrity is
`sha512-o9xwmHOfDxq5pVUCycNUDQwriCEUwWQRd2KGo/MLgpI49X/QUfoLroEfOyzbVXvKzFcNcNE7av5mMjkRmjsleQ==`.
The tarball contains neither source nor tests, and its README SHA-256 is the frozen candidate value.

A fresh installed consumer exercised under Node.js 18.20.8, 22.23.2, 24.19.0, and 26.7.0 exposes
exactly 18 root runtime names and no placeholder/Markdown-resource symbol. All four runs produce
the exact placeholder diagnostic above, block six tested internal runtime subpaths with
`ERR_PACKAGE_PATH_NOT_EXPORTED`, and pass CLI version/help; help is 17 lines with SHA-256
`9f7ed8f6bcb5174a067f9f94794347a3116a93c75d66d8117b6ec78c3fa1e016`. Strict NodeNext with
TypeScript 7.0.2 passes, while the internal graph import fails exactly with `TS2307`. The official
Node.js 18.20.8 macOS arm64 archive `node-v18.20.8-darwin-arm64.tar.gz` SHA-256 is
`bae4965d29d29bd32f96364eefbe3bca576a03e917ddbb70b9330d75f2cacd76`.
The final runtime consumer oracle SHA-256 is
`6064960dab0019555f3cd6d6569af6c9431f15df44d1e9d714cc89b6387f80e4`. A separate bare consumer
added 41 dependencies and audited with zero vulnerabilities.

## Base dist comparison

Independent `--no-local` clones of base and candidate, each built after a cold Node 26 install with
its own empty cache, contain the same 188 regular dist files and three descendant directories, with
zero symlinks or special files. There are no added or removed paths; 11 files change, exactly:

- `validate/agent-skill.{js,js.map,d.ts.map}`;
- `validate/markdown-resource-diagnostics.{js,js.map,d.ts,d.ts.map}`; and
- `validate/markdown-resource-graph.{js,js.map,d.ts,d.ts.map}`.

The other 177 regular files are byte-identical. Package-root artifacts are unchanged:
`dist/index.js` is
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63`, and `dist/index.d.ts` is
`204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`.
Both private build checkouts finish clean.

## External property-tax holdout

The read-only property repository remains clean at
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. Its reviewed Markdown SHA-256 values remain:

| File | SHA-256 |
| --- | --- |
| `SKILL.md` | `9659ee938b816ce1447709615189e8a22c1f3404846062ea2c4eec2538a5aa27` |
| methodology | `106b4f3c58a0715723d6eeb1b4636fef2686ad12673413a846a1d00d5e554d87` |
| appeal routes | `ae29ba79b0f12d5c4a363b2199fbaf2d6d8d33ff5b9f4966a9c5eeb27af14e02` |
| case schema | `ce703c5e75f72f9cef34546c25b0f9137e0e64a0b6d0a9f899165b4b3d161fa9` |

On all three supported Node versions the graph retains four DFS documents, empty graph/resource/
placeholder findings, three root edges at line 12 columns 6, 108, and 201, and totals of four files,
59,712 bytes, 1,872 nodes, three targets, 20 work units, six components, and zero aliases. Direct
full-source analysis has node counts 355, 483, 166, and 871 with empty issues and placeholders.
The public report still contains only `skill.license.missing`, has SHA-256
`b78fa593ecf98ccc2b51aec95f683cc6cd112a4ce1f20608a3d161660a7c76a1`, and preserves the
934-character description. The private property oracle SHA-256 is
`abc506e17fa0092ff6fd3adb25859cc919a18b8ec71fdbdad71ccda66c3157ac`.

## Review incidents and frozen files

The initial production draft used only `typeof`/null checks for nested placeholder transport
objects. Independent review identified that active proxies could reach descriptor traps; the final
candidate uses `isRecord` at inventory, item, and location layers, and the zero-trap oracle passes.

Release harness corrections were transparent: a zsh wrapper used the read-only `status` variable;
the consumer expected-export list was initially unsorted; macOS `tmpdir()` traversed the `/var`
symlink; two temporary-skill naming attempts violated directory-match/portable-name rules; and the
first TypeScript 7 negative invocation hit `TS5112` before module resolution. Each affected check
was corrected and rerun exactly. None changed the candidate, shared checkout, or property holdout.

Frozen candidate files:

- `README.md` — 67 lines — `e6b011fa8a06676c9ab7a464ebf7e050a9c413f9d6f848a5db78b7b046729651`
- `src/validate/agent-skill.ts` — 274 — `18ad12bda6800eb85c914dfbaee13805fd132bf5e2597cd53f8253be3e5ebfa2`
- `src/validate/markdown-resource-diagnostics.ts` — 340 — `8a4270ff5c86f755a22105a3414c70fe4e25e8cfb8c2f4296b7c377d94d9221c`
- `src/validate/markdown-resource-graph.ts` — 1,405 — `8cc1bc5432370a3be42f28f2f8ec65db2f4b61cc02ae854681212068f2434cff`
- `test/agent-skill-validator.test.ts` — 901 — `07ff7e4713f012757f193b51541878a5ab7766b41aaeaf5809327d8404248dac`
- `test/markdown-resource-diagnostics.test.ts` — 309 — `7a27fa4659835683607a9cd8026da98e94292f7191b02baba77120f1761200cf`
- `test/markdown-resource-graph.test.ts` — 2,044 — `2a5706788ba6a28e45b49c606001d149ea81e835f5eca3d0766284c402394ce7`

The candidate, release reconstructions, shared checkout before this docs-only addition, and
property repository all finished clean. The release lane performed zero shared npm operations and
made no shared candidate changes.
