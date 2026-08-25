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

**`reference/`** — *generated, and committed*. The settings and command tables
come from `package.json` via `npm run docs:reference`. Never hand-edit anything
here — regenerate it, and commit the result. CI fails if the committed output
differs from what the source produces.

Committing generated output looks redundant until you watch a review go by: a
pull request that renames a command then *shows* the reviewer that rename,
instead of hiding it behind a build step nobody runs while reviewing. It also
makes the reference readable on GitHub without building the site. There is no
API reference yet — `src/` has no exported surface to document, so TypeDoc waits
for one.

User-facing documentation (install, connect, run, troubleshoot) lives at the top
level of the published site and is authored alongside the slice that ships the
feature it describes. So far that is
[Connection profiles](connection-profiles.md), [Signing in](signing-in.md) and
[Connecting to Viya](connecting.md). A new top-level page has to be
added to `nav` and `sidebar` in `.vitepress/config.mjs` as well — an
unregistered page builds without complaint and is reachable only by typing its
URL.

## Rules

**Docs ship with the slice.** Not at the end, and not in a follow-up. A behaviour
change with no documentation change is an incomplete pull request.

**Do not document what you have not verified.** Claims about Viya behaviour must
be supported by the **Probe findings** section of the relevant phase file
(`docs/phases/phase-N.md`) — findings no longer live in one standalone file. In
particular, no document may claim Viya 3.5 support while it remains unverified —
say so plainly instead. Both AI reviewers are instructed to flag violations of
this.

**Machine-readable facts are generated, never transcribed.** A hand-typed copy of
a settings table is a copy that will silently go stale.

**Say what doesn't work.** A troubleshooting section that only covers the happy
path is decoration. The limitations section is the part users actually need.
