# Phase 12 — AI-agent integration

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 12 — AI-agent integration

Created 2026-09-22 (Sean's own call), moved out of Phase 11 the same day —
see [`docs/phases/phase-11.md`](phase-11.md)'s "Phase 11 follow-up decisions,
and AI-agent integration moved to Phase 12" Runbook entry for the full
account of why. Three of this phase's four slices trace to a 2026-09-21
research memo
([`docs/research/ai-integration-2026-09-21.md`](../research/ai-integration-2026-09-21.md))
answering whether the extension can let a user plug an AI agent they already
have — Claude Code above all — into it; the decision that memo fed is
[ADR-0037](../adr/0037-ai-agent-integration-approach.md). The fourth (12d) is
unrelated in topic — CSV formula-injection guard research, carried over from
a Phase 11 (11d) follow-up — but shares the same shape: a real open question
that needs investigation before it can be sized or built, the same reason
12b/12c are spikes rather than builds.

This phase repurposes a number previously assigned to a different, unstarted
topic ("second execution backend"), renumbered the same day to
[Phase 13](phase-13.md) so it would not collide with this one.

**Sean's explicit call, 2026-09-22: this phase gates v1.0.** Recorded as an
amendment to `PRODUCTION_PLAN.md` §8's "Definition of done — 1.0" — see that
section for the exact wording. This is new, not a reversal of anything
previously said about this phase specifically — the phase did not exist
under this number before today.

1. **12a — Ship an Agent Skill (Option A).** Formerly 11f. A
   `.claude/skills/python-on-viya/SKILL.md` teaching an agent (Claude Code or
   VS Code Copilot agent mode — both read `.claude/skills/` verbatim, per the
   research memo's Finding 14) how this project's execution model actually
   behaves: upload-plus-`infile=` submission rather than inline `endsubmit;`,
   `SYSCC` as a session variable, the interpreter banner/`>>>` markers as
   inherent output rather than a defect (Finding 11.3, `phase-11.md`),
   library/CAS naming, what the environment probe reports, and the existing
   command surface. No production code — a day of writing, per the research
   memo's own estimate.
2. **12b — Spike: an in-process MCP server reachable by an external Claude
   Code session (Option C).** Formerly 11g. Exploratory only, not a
   commitment to build the feature: the narrow question is whether an
   external Claude Code CLI session can actually connect to a loopback HTTP
   MCP server run inside the extension host, with a token handed over out of
   band, and whether the server survives a VS Code window reload — neither is
   promised by any documentation (research memo, "What would have to be
   settled before any code", items 1–2). The spike's own outcome, recorded
   here once run, decides whether a real Option C build gets scoped as a
   later slice or the project falls back to Option B (`languageModelTools`
   over the existing pure adapters), which ADR-0037 holds pending exactly
   this result.
3. **12c — Spike: a Python startup snippet's submission mechanism and
   namespace survival.** Formerly 11h. Investigates, rather than builds, the
   idea (a Phase 11e follow-up) of a profile-level Python startup snippet —
   the Python analogue of 11e's SAS `sasOptions`/`autoExec`. Settles the
   submission path given
   [ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md) (all Python
   reaches the interpreter as an uploaded file via `infile=`, never
   inlined) — is it its own job run at session-create time, alongside
   `autoExec`'s SAS lines, or something else; whether its effect (imports,
   variables) actually survives into the *first* real `Run File`/notebook-cell
   job the same way it already survives between two ordinary runs in one
   session (probably already implied by existing behaviour, but not
   specifically confirmed for a job submitted before any user code has run);
   and, the harder question, what **`proc python restart;`**
   (`RESTART_STATEMENT`, `src/backend/procPython.ts`) does to it — does
   **Reset Python Interpreter** silently drop it with nothing to tell the
   user their setup is gone, or does a reset need to re-run it automatically.
   Outcome recorded here once run; decides whether the startup-snippet idea
   gets sized into a real slice back in a future phase, or stays parked.
4. **12d — Research: does the CSV formula-injection guard need to cover SAS
   library exports too, and how.** Carried over from Phase 11's 11d
   follow-ups, 2026-09-22 — flagged as needing more research than a
   punch-list item implied, rather than a settled "build it, CAS-only" call.
   The CAS-only scoping (an opt-in setting, default off, prefixing a leading
   `=`/`+`/`-`/`@` character cell in `formatCsvPage`, `src/cas/csvFormat.ts`)
   left "should this also cover SAS library table CSV export?" as an
   explicit open question the original item never answered — the SAS
   library path relays the server's CSV untouched
   ([Finding 7.20](phase-7.md)), so guarding it means re-parsing every page,
   a real cost the CAS-only version doesn't pay. An opt-in setting that only
   protects some of a user's CSV exports risks the same silent-gap shape as
   11e's autoExec-error follow-up. This slice investigates the
   library-export cost/shape before anything is decided for either surface,
   rather than shipping the CAS-only version and leaving the library
   question open again.

---

## Runbook

### Phase 12 created, 2026-09-22

Repurposed from a stub previously numbered Phase 12 ("second execution
backend"), which had no content beyond a three-sentence plan paragraph and
was never started — renumbered to [Phase 13](phase-13.md) the same day, so
this number could hold a real, already-scoped body of work instead of
colliding with it. 12a/12b/12c are 11f/11g/11h, moved here unchanged in
substance (see `phase-11.md`'s own "Phase 11 follow-up decisions, and
AI-agent integration moved to Phase 12" Runbook entry for the full account
of what carried over and why); 12d is the CSV-guard research item, similarly
carried over from 11d's follow-ups. None of the four has started as of this
entry.

---

## Probe findings

_No live-Viya probes recorded for this phase yet. Any finding this phase
produces is numbered `12.x`, per this project's per-phase finding-numbering
scheme (see `CLAUDE.md`'s "Don't guess about Viya — probe it" section)._
