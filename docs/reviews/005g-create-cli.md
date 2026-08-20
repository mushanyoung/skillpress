# Review 005g: create CLI

- Slice: `feat: expose strict project creation through the CLI`
- Reviewers: independent subagents `/root/review_create_cli` and `/root/review_cli_contract`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Review findings

The first reviews rejected permissive help/version parsing, untrusted argument reflection, unpaired
Unicode path handling, and missing package-bin coverage. Final hostile review then found two
contract bugs: a success sink could accept output and reject afterward, causing a contradictory
second stderr record, and an oversized argument snapshot could forget an already observed
`--json` request.

## Resolution

- Parse only the documented create flags, reject duplicates, extra positionals, and trailing
  help/version arguments, and never reflect unknown tokens.
- Snapshot at most 64 arguments and 64 KiB before any command await, without consulting an
  attacker-controlled iterator; preserve an observed JSON selection even when the snapshot is
  invalid.
- Reject blank, invalid UTF-8, control, default-ignorable, line-separator, and all Unicode
  noncharacter path values before filesystem access.
- Snapshot synchronous or asynchronous output adapters before work, normalize adapter failures,
  and make every command at-most-one-emission. Once success output is attempted, a sink failure is
  represented only by exit 1 and never by a second contradictory record.
- Keep create exit codes stable: success 0, internal/I/O 1, usage 2, invalid brief 3, and unsafe or
  existing output 4.
- Export the create help, exit-code type, and writer API, and exercise the compiled binary as a
  subprocess.

## Verification

```text
npm run check
npm audit
npm pack --dry-run --json
git diff --check
```

The final candidate passed 152 tests with 96.65% statements and 94.57% branches overall. Reviewers
also probed poisoned getters and thenables, forged errors, all 66 Unicode noncharacters, JSON
metacharacters, argument mutation, and push-then-throw/reject sinks. A clean tarball install ran the
real `.bin` through help, version, create, usage, invalid-brief, I/O, and unsafe-output exits
`0/0/0/2/3/1/4`; package import and declarations passed, and `npm audit` reported no
vulnerabilities.
