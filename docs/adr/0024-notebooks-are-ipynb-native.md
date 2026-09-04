# ADR-0024 — Notebooks are ipynb-native, not a bespoke format

- **Status:** Accepted
- **Supersedes:** nothing directly; settles `PRODUCTION_PLAN.md` §6 open
  decision 7 ("Notebook format... Recommend ipynb... but defer until Phase
  9"), which is now struck through and pointed at this record.
- **Date:** 2026-09-04
- **Decides:** whether this project's Phase 9 notebooks are real,
  `ms-toolsai.jupyter`-and-nbformat-compatible `.ipynb` files, or a bespoke
  notebook format the way the SAS extension's `.sasnb` is
- **Executed in:** Phase 9's scoping session (`docs/phases/phase-9.md`), a
  docs-only pass with no code — the mechanics of *how* this is implemented
  (in particular, whether a `NotebookController` alone is sufficient or
  something more is needed) are still open and belong to 9a's own spike; this
  ADR settles the format question itself, not the implementation detail

## Context

`PRODUCTION_PLAN.md` §3.1 already named notebooks as one of three areas this
project intends to *exceed* the SAS extension rather than match it ("ipynb
rather than a bespoke format"), and §6's open decision 7 carried a soft
recommendation for ipynb, explicitly deferred until Phase 9 actually started.
Phase 9's scoping session (this same day) surveyed both the SAS extension's
own notebook implementation and VS Code's Notebook API documentation to turn
that soft recommendation into a real decision.

The SAS extension's choice is instructive precisely because it does not
transfer. Its `.sasnb` format (`client/src/components/notebook/Serializer.ts`)
is a flat, non-Jupyter JSON array with no notebook-level metadata, registered
under a bespoke `notebookType`. That is a reasonable choice for SAS: a
`.sasnb` file opened in Jupyter, JupyterLab, or GitHub would be meaningless
JSON, so nothing is lost by inventing a format nothing else can read anyway.

Python is the opposite case. This project's own `RichOutput` union
(`src/backend/backend.ts`) — `text/plain`, `text/html`, `image/png`,
structured tracebacks — is already exactly the mime-bundle shape nbformat's
own cell-output model expects. A `.ipynb` this extension produces would
already be a well-formed Jupyter notebook, renderable and diffable by any
ipynb-aware tool with zero knowledge of this extension, purely as a
consequence of the output types this project already has reason to produce.
A bespoke format would throw that away for no compensating benefit — there
is no SAS-log-vs-ODS-HTML asymmetry here forcing a custom shape the way there
was for SAS.

VS Code's own extension guide documents a path to get real ipynb support
without owning serialization at all: a `NotebookController` can be
"published separately from its serializer," registered as an alternative
kernel for an *existing* notebook type — its own worked example is a second
kernel for the `github-issues` notebook type. This is the same shape the
.NET Interactive and Deno Jupyter kernels use for `.ipynb` today; neither
reimplements `.ipynb` serialization. If the same pattern applies to
`jupyter-notebook` (the notebook type `.ipynb` files use), this project
would gain real, portable `.ipynb` support by shipping only an execution
seam, not a file-format seam.

## Decision

**Phase 9 notebooks are ipynb-native. There is no bespoke fallback format.**
This project will not build or maintain a second, proprietary notebook
format for Python the way the SAS extension built `.sasnb` for SAS. A
developer already using Jupyter/`.ipynb` notebooks — in this extension, in
JupyterLab, on GitHub, anywhere — gets a seamless, standards-based
experience: the same file format, opened the same way, portable outside this
extension entirely.

**What is still open, and deliberately left to 9a, is implementation
mechanics, not the format choice.** Specifically: whether a bare
`NotebookController` targeting the existing `jupyter-notebook` notebook type
is sufficient on its own, or whether this project needs to depend on (or
recommend) `ms-toolsai.jupyter` being installed for `.ipynb` files to open
as notebooks at all in a clean VS Code install. Nothing found during Phase
9's scoping states that directly one way or the other — it requires a
hands-on spike, not a documentation read. That spike still happens at the
start of 9a, exactly as `docs/phases/phase-9.md` already schedules it. Its
outcome will decide *how* ipynb support is wired (a zero-dependency
`NotebookController` alone, versus one that documents `ms-toolsai.jupyter`
as a soft or required companion extension) — it will not reopen whether to
go ipynb-native at all.

## Alternatives considered

**Bespoke format, mirroring `.sasnb`.** Rejected outright. The reasoning
that justified `.sasnb` for SAS — no other tool can read SAS-flavoured
notebook JSON, so a custom shape costs nothing — does not hold for Python,
where the entire value of a notebook is that it interoperates with an
enormous existing ecosystem (JupyterLab, nbconvert, GitHub's own `.ipynb`
rendering, `nbformat`-aware tooling generally). Choosing bespoke here would
be strictly worse for users for no design benefit in return.

**Defer the format decision itself to 9a's spike, treating the spike's
outcome as a decision between ipynb-native and bespoke.** This was the
scoping session's own original framing, and it is superseded by this ADR.
On reflection, the spike's only genuine unknown is a dependency/packaging
question (does `.ipynb` support need `ms-toolsai.jupyter`), not whether
ipynb is the right target format — the case for ipynb over bespoke does not
depend on that answer either way. Leaving the format itself contingent on
the spike would have meant a real risk of drifting into "the spike was
inconclusive, so we built `.sasnb`-for-Python by default" — exactly the
outcome this decision exists to foreclose.

## Consequences

**9a's own scope narrows to implementation mechanics.** It no longer carries
a live fork between "write a `NotebookController`" and "write a
`NotebookController` *and* a `NotebookSerializer* and register a bespoke
notebook type" — only the former is in scope. The spike still gates *how*
the controller reaches `.ipynb` files, but not *whether* `.ipynb` is the
target.

**A soft or required dependency on `ms-toolsai.jupyter` is now a real
possible outcome of 9a, not a reason to abandon ipynb.** If the spike shows
`.ipynb` files don't open as notebooks at all without that extension
installed, this project documents it as a recommended (or required)
companion extension — the same way `.NET Interactive` and Deno's kernels
already do — rather than retreating to a bespoke format to avoid the
dependency. This is a real, user-facing cost worth being honest about in
`docs/` once 9a lands, not one to paper over.

**`PRODUCTION_PLAN.md` §6 open decision 7 is struck through and points here**,
consistent with how every other settled §6 decision is recorded.
