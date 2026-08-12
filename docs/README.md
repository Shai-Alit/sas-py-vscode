# Documentation

How this directory is organised, and where to add things.

## Layout

**`architecture/`** — how the system is put together and why. The dialect layer,
the `ExecutionBackend` seam, the capability probing model, the log-to-output
pipeline. Written for someone who needs to change the design, not merely use it.

**`adr/`** — decision records. Immutable once accepted; superseded rather than
edited. See [adr/README.md](adr/README.md).

**`dev/`** — contributor operations: building, debugging the extension host,
capturing and sanitising fixtures, running the live test tier, the release
process, and the AI reviewer setup.

**`reference/`** — *generated*, and git-ignored. The settings and command tables
come from `package.json`; the API reference comes from TSDoc via TypeDoc. Never
hand-edit anything here — regenerate it. CI fails if the committed output differs
from what the source produces.

User-facing documentation (install, connect, run, troubleshoot) lives at the top
level of the published site and is authored alongside the slice that ships the
feature it describes.

## Rules

**Docs ship with the slice.** Not at the end, and not in a follow-up. A behaviour
change with no documentation change is an incomplete pull request.

**Do not document what you have not verified.** Claims about Viya behaviour must
be supported by [`PROBE-FINDINGS.md`](../PROBE-FINDINGS.md). In particular, no
document may claim Viya 3.5 support while it remains unverified — say so plainly
instead. Both AI reviewers are instructed to flag violations of this.

**Machine-readable facts are generated, never transcribed.** A hand-typed copy of
a settings table is a copy that will silently go stale.

**Say what doesn't work.** A troubleshooting section that only covers the happy
path is decoration. The limitations section is the part users actually need.
