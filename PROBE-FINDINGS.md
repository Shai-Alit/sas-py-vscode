# PROBE-FINDINGS.md

**This file no longer holds probe findings directly.** The 2026-08-24 docs
restructuring (`docs: split runbook/plan/findings into per-phase files`,
PR #52) split the original `PROBE-FINDINGS.md` into `docs/phases/phase-N.md`
— one file per phase, each bundling its own plan section, runbook punch
list, and a **Probe findings** section. See [STATUS.md](STATUS.md) for which
phase is current and which phase file to open.

That restructuring commit was itself tagged `[skip-review]`, so the AI
reviewers never saw this file disappear, and roughly thirty references
across this repository — the PR template, `CONTRIBUTING.md`, `README.md`,
`PRODUCTION_PLAN.md`, the root `RUNBOOK.md`, several ADRs, `src/` doc
comments, test fixture READMEs, and this repo's own AI-reviewer
configuration (`.github/scripts/ai_review.py`,
`.github/workflows/claude-review.yml`) — still point at this file as if it
were the single, current evidence base. This stub exists so those pointers
resolve to something true instead of a 404, without redoing every one of
those citations in the same pass. If you're the one doing that fuller sweep,
this paragraph (and the notes it points at) is where to start.

## Finding a specific numbered finding

**Every citation elsewhere in this repo reading "see `PROBE-FINDINGS.md`,
finding *N*" or "`PROBE-FINDINGS.md` findings *A*–*B*" is a historical
citation**, written before the split, and finding numbers were **not**
renumbered when the content moved. To find finding *N*: search
`docs/phases/*.md` for `Finding N —`. Each phase file's own **Probe
findings** section is chronological and dated, and later phases continue
the numbering the earlier ones left off (as of this writing, findings run
through 66, in `docs/phases/phase-3.md`).

## For a reviewer checking a claim against this file

Per this repo's own AI-reviewer instructions ("verified Viya behaviour is
in `PROBE-FINDINGS.md`... flag any claim that `PROBE-FINDINGS.md` does not
support"): **the evidence base is `docs/phases/*.md`, not this file.** Check
the phase file for the slice under review, and earlier phases' files if the
claim could have been settled before this slice started. This file has
nothing left to check a claim against.

## Maintenance

This file is not maintained further. New findings from any future probe go
directly into the relevant `docs/phases/phase-N.md`'s own **Probe findings**
section — do not add a new finding here.
