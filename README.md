# sas-py-vscode

Run Python on SAS Viya from Visual Studio Code — using the Python packages your
Viya administrator installed and manages, without installing Python locally.

> **Status: pre-release, under active development.** Nothing is published to the
> marketplace yet. See [STATUS.md](STATUS.md) for the current phase, or
> [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md) for the overall architecture and plan.

> **Not a SAS product.** This is an independent project. It is not built,
> endorsed, or supported by SAS Institute Inc. It reuses Apache-2.0 licensed code
> from [`sassoftware/vscode-sas-extension`](https://github.com/sassoftware/vscode-sas-extension);
> see [NOTICE](NOTICE).

## What it does

The [SAS extension for VS Code](https://github.com/sassoftware/vscode-sas-extension)
lets you write SAS code locally and run it on Viya. This does the same thing for
Python: you edit `.py` files on your machine, and they execute inside a Viya
compute session against Viya's managed Python environment — the one at
`/opt/sas/viya/home/sas-pyconfig/default_py`, with whatever `pandas`, `numpy`, and
`swat` versions your deployment ships.

That matters in environments where you can't install Python locally, where the
data can't leave Viya, or where you simply want your development environment to
match production exactly.

## Why not just use a local Python?

Because the interesting data and the interesting packages are on the server. A
local interpreter gives you neither, and a notebook server sitting beside Viya
gives you a second environment to keep in sync. Running in Viya's own compute
session means the code you tested is the code that will run.

## Design constraints

These are commitments, not aspirations:

**No local Python required.** The extension is TypeScript and talks to Viya over
REST. If you have no Python on your machine, everything still works.

**Viya 3.5 and Viya 4 both supported.** Version differences live in a dialect
layer rather than scattered conditionals. SAS 9 is explicitly out of scope.

**Complementary to the SAS extension, not a replacement.** Install both. That one
authors SAS; this one authors Python. Neither needs the other.

**Editing intelligence is delegated.** Completion, hover, and refactoring come
from `ms-python.python` and Pylance. This extension owns execution, not language
services.

**Where your code runs is something you set, and something you can see.** Each
workspace has a run target — a Viya profile, or Local — chosen from the status
bar, which always names it. On Local this extension contributes nothing to the editor:
the run button you already had is Microsoft's, and we neither wrap it nor start an
interpreter of our own. The target decides where our commands appear, never what
they do, so nothing changes meaning under your hands. See
[ADR-0011](docs/adr/0011-choosing-where-python-runs.md).

**Tested, and honestly so.** Unit tests mock at the HTTP boundary with no network;
fixtures exist per Viya generation; a live tier runs against a real deployment and
is opt-in. Behaviour we haven't verified against a real Viya is documented as
unverified — see [PROBE-FINDINGS.md](PROBE-FINDINGS.md).

**No telemetry.** None is collected. There is no setting to turn off, because
there is nothing to turn off.

## Documentation

- [STATUS.md](STATUS.md) — current phase, and which phase file to open
- [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md) — cross-cutting architecture, test strategy, quality gates, risks, open decisions
- [RUNBOOK.md](RUNBOOK.md) — repo setup, the per-slice loop, cross-cutting reminders
- [docs/phases/](docs/phases/) — per-phase plan detail, punch list, and probe findings, bundled one file per phase
- [docs/release-checklist.md](docs/release-checklist.md) — cutting a release
- [docs/ai-reviewer-setup.md](docs/ai-reviewer-setup.md) — AI PR reviewer bootstrap
- [docs/adr/](docs/adr/) — architecture decision records
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to build, test, and submit changes
- [SECURITY.md](SECURITY.md) — reporting vulnerabilities
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — expectations for participation

`PROBE-FINDINGS.md` and the old undivided `RUNBOOK.md`/`PRODUCTION_PLAN.md` phase
content now live under `docs/phases/` — see `STATUS.md`.

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
