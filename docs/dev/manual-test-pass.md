<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# manual-test-pass.md

**This file no longer holds the manual test pass directly.** At the Phase
7→8 between-phase housekeeping checkpoint (2026-09-11), it was split into
[`docs/dev/manual-tests/`](manual-tests/setup.md) — one file per phase, plus
a `setup.md` for the phase-agnostic pre-flight/activation checks and a
`misc.md` for the phase-agnostic trust/enablement and regression
spot-checks. Every item in the new split carries a stable number (`S.1`,
`1.1`, `6.4`, `M.2`, …) instead of a bare bullet, so it can always be
referenced exactly — the same convention this project's probe findings
already use.

**Start at [`docs/dev/manual-tests/setup.md`](manual-tests/setup.md)** — it
has the index of every other file, the tagging legend, and the
pre-2026-09-11 chronological history of full passes (kept there verbatim,
since that history was written against this file's own old, single-file `§N`
numbering).

## Why the split

A single, ever-growing file made it easy to lose a phase's own tests inside
another phase's section, and easy to forget a phase had no section here at
all. One file per phase — matching `docs/phases/phase-N.md`'s own
convention — means a session working one phase opens exactly one test file,
and a phase that hasn't started yet has an empty stub waiting for it rather
than no home at all.

## References that remain

Citations elsewhere in this repo reading "`manual-test-pass.md`, §*N*" are
**deliberate historical citations** — true when written, against this file's
old numbering, in ADRs, `docs/phases/*.md` Runbook entries, `STATUS.md`, and
`docs/status-archive.md`. They are not an outstanding task — leave them; see
`manual-tests/setup.md`'s own History section for the `§N` → new-file
mapping if one needs tracing down.

## Maintenance

This file is not maintained further. A new manual-test item for any phase
goes directly into that phase's own `docs/dev/manual-tests/phase-N.md` (or
`setup.md`/`misc.md` for phase-agnostic checks) — do not add anything here.
