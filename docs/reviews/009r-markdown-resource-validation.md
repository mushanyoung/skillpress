# Review 009r: validate Markdown resource references

- Slice: `feat: validate skill resource references`
- Review: independent contract, test-plan, release, and real-skill reviews
- Date: 2026-08-20
- Frozen base: `cd273381644a979ad2c73a1e892b05ddb83138fa`
- Final result: PASS

## Scope

This slice connects the previously reviewed Markdown resource graph to the public Agent Skill
validator. It changes the validator orchestration and README, adds one internal diagnostic adapter,
and adds focused mapping and integration tests. It does not change the public TypeScript types,
report schema, package root exports, package export map, CLI arguments, configuration, resource
graph producer, resource-tree authority, or legacy document-reader module.

The public validation path is now:

1. inspect the canonical skill root;
2. inspect the exact `SKILL.md` entry without reading its content;
3. run one bounded resource-graph transaction from that genuine inspection;
4. parse only the `documentText` returned by that graph transaction;
5. validate frontmatter fields, then add graph findings and finish the report.

The old `loadAgentSkillDocument` content read is no longer part of public validation. The parser and
resource diagnostics therefore cannot observe different reads of `SKILL.md`. The graph module is
imported beside the inspection modules in `agent-skill.ts`; `skill-document.ts` does not import it,
so the graph-to-session-to-document dependency remains acyclic.

The canonical directory basename comes from the inspected root path, not caller spelling. Optional
`graph` and Markdown `location` fields are consumed only through module-initialization snapshots of
`Object.getOwnPropertyDescriptor`, including an own-data check for the descriptor's `value` slot.
Inherited properties and accessors are ignored.

## Diagnostic contract

The new internal adapter maps all 42 graph-finding variants and all 14 outer failure reasons with
exhaustive switches and fixed messages. Every graph finding is an `error` in `skillpress` scope.
Only the finding's source `file`, `line`, and `column` may be copied. The adapter never reads or
reports raw destinations, target paths, alias spellings, absolute paths, analyzer messages, entry
metadata, or source text.

| Graph family | Public code family | Variants |
| --- | --- | ---: |
| Markdown analysis | existing `skill.markdown.*` | 6 |
| Destination syntax | `skill.reference.destination.*` | 19 |
| Local resolution | `skill.reference.*` | 5 |
| Referenced-file read | `skill.reference.read.*` | 5 |
| Aggregate budget | `skill.reference.budget.*` | 7 |

Root-document `too_large`, `invalid_utf8`, and `invalid_read` retain their existing
`skill.document.*` diagnostics. `changed` maps to `skill.root.changed`; unsupported-kind and
resource-tree bound failures retain specific `skill.resources.*` codes; opaque invalid, aborted,
inventory, metadata, consistency, and IO failures map to one fixed `skill.resources.read`
diagnostic. Root-document failures use `SKILL.md`; tree/session failures use `.`.

Frontmatter parsing and field validation add their diagnostics before graph findings. This
preserves root-document priority under the collector's first-255 admission cap. Final public order
remains the collector's canonical sort. A malformed YAML envelope still contributes its graph
findings; a graphless lexical envelope is diagnosed by the existing parser exactly once.

`graph.complete` describes traversal completeness, not validity. A complete graph containing a
missing, unsafe, ambiguous, or noncanonical reference still makes validation fail. An incomplete
graph does not produce a redundant generic diagnostic because its Markdown, read, or budget finding
already states the cause.

## Authored verification

The focused selection passes two files and 72 tests. The 57-case adapter suite covers every
finding/failure mapping, exact code/message/scope/location, absence of sensitive payloads, and a
poisoned inherited optional `location`. The validator suite additionally covers:

- a hermetic property-tax-style skill with three traversed local Markdown references and six inert
  path mentions in code spans;
- exact DFS documents, edges, locations, reachable files, totals, public metadata, and the existing
  portable license warning;
- root links covering missing, dot-component, noncanonical, and a referenced invalid-UTF-8 Markdown
  file without leaking raw or absolute paths;
- a complete graph with a missing target, proving that `complete:true` is not a validity gate;
- graphless Markdown and malformed YAML without duplicate or prematurely skipped diagnostics;
- two root field errors admitted before 253 reference errors and the truncation diagnostic;
- missing roots/documents, invalid UTF-8, and oversized root documents with legacy diagnostics;
- a mocked legacy content reader that throws if called and is observed zero times.

In the final coverage run, `agent-skill.ts` reaches 100% statements, 98.50% branches, 100%
functions, and 100% lines; the adapter is 100% in all four categories. The shared final
`npm run check` passes formatting, lint with warnings as errors, generated-file checks, type
checking, build, and 49 files / 565 tests. Global coverage is 95.70% statements, 94.36% branches,
99.80% functions, and 97.29% lines.

## Independent release review

A fresh reconstruction from the frozen base matched all five file hashes. Node.js 22.23.2,
24.19.0, and 26.7.0 each pass the full 49-file / 565-test suite. Both the complete dependency audit
and `npm audit --omit=dev` report zero vulnerabilities.

Bare packing on Node.js 26.7.0/npm 12.0.2 runs the prepack build and produces 187 entries,
158,013 packed bytes, and 831,140 unpacked bytes. The npm SHA-1 is
`cbc08b3a08decdb58796803afc73f98e073f510d`; the tarball SHA-256 is
`de7ba949e870490a9767effaedd6c6c1a10a0bafec2fda59aa0c9753931aa7da`.
The final README hash is present in the tarball, and neither source nor tests are packed.

Fresh installed ESM, TypeScript, CLI, and nested-reference consumers pass on all three Node
versions. The root runtime still exposes exactly 18 names. The graph and diagnostic adapter are
absent from root runtime and declarations, and exact imports of both compiled internal subpaths
fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. `dist/index.js` and `dist/index.d.ts` remain
byte-identical to base, with SHA-256
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63` and
`204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`.

## Real-skill oracle

The external read-only oracle uses clean property-tax repository commit
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. Its four exact source hashes are retained outside this
repository's CI; CI uses a short hermetic equivalent instead.

Across all three Node versions, the real graph contains four DFS documents and three inline root
edges at line 12, columns 6, 108, and 201. Totals are 4 files, 59,712 bytes, 1,872 nodes, 3 targets,
20 work units, 6 components, and 0 aliases. Findings are empty. The six path-like code-span mentions
remain inert. Public validation returns only the existing `skill.license.missing` portable warning
and preserves the exact name and description metadata.

## Boundaries and review incidents

The graph remains a bounded observation rechecked before publication, not an `openat` filesystem
transaction or reusable authority. Only CommonMark link/image targets are analyzed. Code spans,
bare paths, and raw HTML are not followed; external URLs are not fetched; fragment anchors are not
validated. The retained Markdown parser remains a fallible dependency boundary as recorded in
Review 009q0b.

One release-review command used the private parent directory instead of its private candidate and
rebuilt `/private/tmp/node_modules`; it did not touch the shared repository, private candidate, or
property-tax repository. Initial private consumer harnesses also exposed the intended macOS
temporary-directory symlink rejection and missing consumer-local Node type dependency/configuration.
The reviewer corrected those harnesses and reran every affected gate. These were review-harness
incidents, not candidate defects.

## Frozen files

- `README.md`: `6048d1c9b234233dfcd73278963a88fed7f58b84cee99f3537cc1778ec1b475f`
- `src/validate/agent-skill.ts`:
  `550bf1c617626312097d724d56a3134b9677a7883abbc93676c7779d100be124`
- `src/validate/markdown-resource-diagnostics.ts`:
  `65b42154c6726b51cd753c385aefae3db668a97cac80ae3b8166bba182cdfeee`
- `test/agent-skill-validator.test.ts`:
  `d2ada30c5969ae3481a30d57e898e6ec9ec55a97eda37bf90c937cace312cf8c`
- `test/markdown-resource-diagnostics.test.ts`:
  `c039c12f38bfb7bf65d9668c227cf15647477ffc52562cc62f6b6f93b13358ee`

The review record changes none of those files and adds no public export, schema, configuration,
resource authority, network operation, or executable behavior.
