# SkillPress

SkillPress builds, evaluates, packages, and publishes production-grade Agent Skills. It combines
an installable skill with a typed CLI so open-ended authoring stays agent-friendly while quality,
testing, provenance, and publication gates remain deterministic and auditable.

The project is under active development. The future npm package is
`@mushanyoung/skillpress`; the unscoped `skillpress` name belongs to a different project and will
not be used.

```bash
npm install
npm run build
node dist/bin.js --help
```

Create accepts a complete, strictly validated capability brief and refuses partial TODO-style
scaffolds:

```bash
skillpress create --brief capability-brief.yaml --output ./my-skill
skillpress create --brief capability-brief.yaml --output ./my-skill --json
```

The brief contract is defined by
[`schemas/capability-brief.schema.json`](schemas/capability-brief.schema.json). Exit codes are `0`
for success, `1` for unexpected I/O/internal failure, `2` for usage, `3` for an invalid brief, and
`4` for an unsafe or already-existing output.

The project writer accepts only a bounded, snapshotted rendered manifest. The destination must not
exist: SkillPress claims it atomically, never overwrites an existing path, and keeps an incomplete
marker if unknown concurrent data prevents safe rollback.
The output parent and other processes running as the same operating-system account are a trust
boundary during creation; portable Node.js does not expose the directory-relative filesystem
primitives needed to sandbox a malicious same-account process. Run untrusted work in the isolated
runner introduced by the evaluation workflow, not alongside `create` in the same account.

SkillPress distinguishes local readiness from Tessl's official Quality and Impact scores. It will
only report the latter when current Tessl evidence exists, and the release profile defaults to a
minimum of 90 for both.

See [the reviewed implementation plan](docs/PLAN.md) for architecture, security boundaries,
registry capabilities, and the small-commit delivery sequence.

## License

MIT
