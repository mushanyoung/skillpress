# Review 009g: cooperative AbortSignal sampling

- Slice: `feat: sample cooperative cancellation`
- Review: independent API review and adversarial runtime oracle
- Date: 2026-08-20
- Frozen base: `d21a96fb961ad617ca6fd7a655996252c2d1fcd4`
- Final result: PASS

## Scope and guarantees

The new internal `sampleAbortSignal` helper is a total, synchronous sampler for optional
cooperative cancellation. It returns one of four primitive states: `absent` only for `undefined`,
`active` or `aborted` for an accepted signal, and `invalid` for rejected inputs or sampling
failures. The accompanying `AbortSignalSample` type fixes that complete result domain. The helper
does not retain the signal, subscribe to events, inspect an abort reason, throw an `AbortError`, or
use a racing promise. A later bounded operation can therefore sample before and after each await
without introducing listeners or claiming that in-flight work can be interrupted atomically.

Module initialization captures `util.types.isProxy`, `Object.getPrototypeOf`, the current-realm
`AbortSignal.prototype`, its native `aborted` getter, and `Reflect.apply`. Sampling rejects
non-objects, proxies, revoked proxies, structural clones, polyfills, inherited signal-shaped
objects, and values whose exact prototype is not the captured current-realm prototype before the
native getter is invoked. This prevents common proxy traps and caller-defined `aborted` accessors
from running. The captured getter result is accepted only when it is strictly `true` or `false`;
throws and non-boolean results collapse to `invalid` without exposing an error or other raw value.
Post-import changes to the global constructor, prototype getter, proxy detector, prototype lookup,
or invocation intrinsic do not affect the sampler.

This gate is deliberately not an authenticity brand and grants no authority. JavaScript code that
reproduces implementation-compatible hidden state while using the accepted exact prototype can
control the sampled hint state. That limitation is expected: cancellation is an untrusted,
cooperative control hint, while filesystem inspection authority continues to come from the
separate module-private provenance boundaries. Neither the package root nor the package export map
exposes this internal helper as a supported public API or subpath.

## Independent review

Two independent reviewers reproduced the frozen candidate in fresh private worktrees and returned
PASS with zero blockers. Their additional hostile probes covered transparent, malicious, and
revoked proxies with zero trap calls; ordinary clones and polyfills; active-to-aborted resampling;
strict non-boolean handling in an isolated module instance; abort-reason and listener
non-observation; initialization-time and post-import intrinsic pollution; and the explicit crafted
receiver caveat. Both reviewers also confirmed that the package root and subpath export boundary
remain closed.

The runtime oracle passed on Node.js 22.23, 24.19, and 26.7 with identical sampler semantics. Each
fresh review reproduced all 410 repository tests and the new module's coverage result. Production
dependency audit reported zero vulnerabilities, and package construction succeeded with 155 dry-run
entries.

## Verification

The frozen candidate is based on
`d21a96fb961ad617ca6fd7a655996252c2d1fcd4`. Its implementation SHA-256 is
`0ad9c36dedd4fcd0b3fb9ca9914228287ff8f3cad15923b2b4a117e4b012f701`, and its contract-test
SHA-256 is `af9ce1a13e1284631cc98e1236420694cad28f05789f873c87ee6c8443ac6555`.

The focused verification passes 6 tests. The complete candidate check passes 33 test files and 410
tests with 97.23% statement, 95.50% branch, 99.67% function, and 97.63% line coverage. The new
abort-signal module reaches 95.65% statements, 93.75% branches, 100% functions, and 100% lines.
Formatting, lint, generated-file freshness, type checking, coverage thresholds, and whitespace
validation all pass for this pre-commit candidate.
