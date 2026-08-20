# Review 009b: filesystem inspection authority

- Slice: `feat: authenticate filesystem inspections`
- Reviewers: independent subagents `/root/review_derived_core_provenance` and
  `/root/review_inspection_authority_api`
- Author: subagent `/root/design_unicode_generator`, finalized by root agent
- Date: 2026-08-20
- Final result: PASS

## Scope and guarantees

Agent Skill root and `SKILL.md` inspections now carry internal identity provenance. Each producer
registers only a completed, deeply frozen inspection in a module-private WeakSet, and the new
internal predicates authenticate identity without reading caller properties. Structural clones,
spread copies, inherited objects, proxies, revoked proxies, and objects created by a different
module instance cannot cross this authority boundary.

A document inspection accepts only a root produced by the current root-inspection module. A forged
root is rejected with the existing stable `skill.root.changed` diagnostic before directory open,
metadata lookup, or freshness callbacks run. The document retains the same genuine root identity
and is registered only after the exact `SKILL.md` metadata and final root freshness check succeed.
The existing low-level structural freshness and document-read APIs remain compatible; provenance
is a separate authenticity check and never substitutes for revalidation before or after later
filesystem operations.

The retained authority graph uses initialization-time snapshots for freezing, WeakSet operations,
safe own-slot construction, string splitting, Node path operations, and Node filesystem adapters.
The complete filesystem-root-to-skill-root component chain, every scalar metadata snapshot, the
component array, root record, document metadata, and document record are frozen before
registration. Resolve and canonical paths must be primitive strings. Failed or malformed attempts
never receive provenance.

## Independent review

The first review reproduced and then verified closure of three authority defects before approving
the final candidate. A live `Object.freeze` replacement had allowed mutable genuine records; live
array push and iterator changes had allowed genuine roots with missing ancestors; and refreshed
Node ESM builtin bindings had allowed altered root chains or an external document path. The final
implementation captures each relevant dependency at module initialization and no longer uses live
array protocols while constructing or checking the retained component chain.

Independent defensive probes replaced freeze, array push/filter/iteration, inherited numeric
setters, string splitting, and Node path/filesystem named exports after module initialization. The
result remained a complete, deeply frozen authority graph with the original root chain and exact
document path. Non-string resolve or canonical results, failed inspections, clones, proxies,
revoked proxies, and foreign-module instances were rejected without gaining provenance or causing
untrusted property reads. The package root exposed neither internal verifier.

## Verification

The author's four-file focused run passes 37 tests. An independent reviewer ran a broader 43-test
focused selection plus six separate defensive probes. The clean repository check passes 343
committed tests with 97.61% statement, 95.88% branch, 99.63% function, and 97.76% line coverage.
Formatting, lint, generated freshness, type checking, and the production dependency audit pass
with zero vulnerabilities.

Package construction and clean root-import checks pass without changing the public export map.
The authority predicates remain internal until the complete resource-tree validator consumes
them. This provenance proves that an object came from the inspected pipeline; it does not make the
snapshot permanently current or claim atomic protection against concurrent filesystem swaps.
