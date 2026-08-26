# PROBE-FINDINGS.md

**This file no longer holds probe findings directly.** The 2026-08-24 docs
restructuring (`docs: split runbook/plan/findings into per-phase files`,
PR #52) split the original `PROBE-FINDINGS.md` into `docs/phases/phase-N.md`
— one file per phase, each bundling its own plan section, runbook punch
list, and a **Probe findings** section. See [STATUS.md](STATUS.md) for which
phase is current and which phase file to open.

That restructuring commit was itself tagged `[skip-review]`, so the AI
reviewers never saw this file disappear, and roughly thirty references across
this repository were left pointing at it as if it were the single, current
evidence base. **That sweep is complete as of 2026-08-25.** Every *live
instruction* — the AI-reviewer configuration, the PR template,
`CONTRIBUTING.md`, the root `RUNBOOK.md`, `README.md`, `PRODUCTION_PLAN.md`,
and the test fixture guidance — now points at the phase files instead.

References that remain are **deliberate historical citations**: ADRs, entries
inside `docs/phases/*.md`, `CHANGELOG.md`, `src/` doc comments, and per-fixture
READMEs recording where a fixture came from. Those were true when written,
finding numbers were never renumbered, and rewriting them would edit the
record for no gain. They are not an outstanding task — leave them.

## Finding a specific numbered finding

**Every citation elsewhere in this repo reading "see `PROBE-FINDINGS.md`,
finding *N*" or "`PROBE-FINDINGS.md` findings *A*–*B*" is a historical
citation**, written before the split, and finding numbers were **not**
renumbered when the content moved. To find finding *N*: search
`docs/phases/*.md` for `Finding N —`. Each phase file's own **Probe
findings** section is chronological and dated, and later phases continue
the numbering the earlier ones left off — the highest-numbered findings are
in the latest phase file that has any.

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
