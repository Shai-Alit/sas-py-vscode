# Phase 5 — Hardening and first release

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 5 — Hardening and first release

**Scoped 2026-09-02**, after Phase 4's close and the Phase 4→5 housekeeping pass
(`baacf3c`; see `STATUS.md`). Technical grounding below came from a codebase
survey done the same session, before any code was written. The plan text below
predates Phases 2–4 in places, and reality has moved further than it assumed —
**5a and 5b are both smaller than originally scoped**, because most of what they
describe already exists. **5d is new**: it carries four cross-cutting items that
Phase 3/4's own review passes and the Phase 4→5 housekeeping pass left with no
phase-file home, previously tracked only in the project-folder scratch file
`phase-3-runbook-pending.md` (now folded in here and trimmed there).

**5a — Drift gate hardening.** `scripts/check-contracts.mjs` already exists,
already checks contract ↔ dialect ↔ fixtures in both directions (present since
2b/2c), and is **already** wired into `npm run verify`, which
`.github/workflows/ci.yml`'s `verify` job already runs on every code-touching
PR — so the plan's original "wires it into CI as a gate" is done, not open.
What's actually open is an audit of what the checker does **not** yet catch: an
empty or stale fixture directory that still satisfies "names a directory under
`test/fixtures/`"; a fixture directory nobody's contract points at; whether the
doc comment's `path`/`via` XOR rule (declare one, never both, never neither) has
a negative-case test exercising the "declares both" and "declares neither" arms
specifically. *Small*, downgraded from *Small/medium* now that the CI-wiring
half is confirmed already done.

**5b — Live test tier.** Also substantially built already: `test/live/` has
three suites (`submission-corpus.test.ts`, `proc-python-rich-output.test.ts`,
`viya4-job.test.ts`); `test/helpers/live-gate.ts` implements the three-gate
design (spec-file isolation via `.mocharc.live.json`, an env-var-pair validation
gate, and a separate mutation gate) for **both** `viya4` and `viya35`
generations already; `npm run test:live` exists and is excluded from default CI.
What's genuinely open: **there is no `viya35` test file at all** — not even a
skipped scaffold — despite `liveTarget("viya35")` already being fully reachable
code. The plan's own "3.5 tier as a skipped scaffold" line is the one real gap,
plus an audit of whether the three existing viya4 suites still cover what
Phase 3/4 actually shipped (Findings 75/76's cancel behaviour, 4c/4d's
diagnostics) or whether a live-coverage gap exists there too. *Small*, downgraded
from *Medium*.

**5c — Docs publishing and release engineering.** This is where the plan text
holds up, and is now the largest slice in the phase. `docs/release-checklist.md`
already exists (Section D), but its own D5 step ("watch the release workflow")
names a workflow that doesn't exist yet — `.github/workflows/` has `ci.yml`,
`ai-review.yml`, `claude-review.yml`, `codeql.yml`, and `link-check.yml`, and no
publish/release file. `package.json` is still `"private": true` at version
`0.0.1`, with no marketplace icon asset. The larger gap: the docs site
(`docs/connecting.md`, `docs/connection-profiles.md`, `docs/signing-in.md`) has
**zero user-facing pages for actually running Python** — Run File/Selection,
output streaming, cancel, diagnostics/click-to-jump, environment info — despite
that being the whole of Phases 3–4's shipped feature set, and there is no
troubleshooting guide yet either. *Medium*, as planned, likely toward the
*large* end of medium once the missing docs pages are accounted for.

**5d — Deferred hardening carried over from Phase 3/4.** Four independent,
already-diagnosed items with no phase-file home before this scoping session:

- **The certificate escape hatch**, raised 2026-08-20 in Phase 3 and still
  unresolved: whether the shipped extension needs a user-facing step for a
  deployment presenting an incomplete certificate chain, the way the SAS
  extension needs none.
- **A BOM fixture** for the submission-fidelity corpus, deferred rather than
  dropped in 3a — no case in the corpus today starts with `EF BB BF`.
- **Finding 74's two sub-findings**, triaged in 4c (`phase-3.md`'s own Finding
  74 entry): the interpreter banner and `>>>` markers read as noise to a person
  even though they are correctly *not* log noise by the output filter's own
  definition (a UX gap, not a parsing one); and `writeOutcome`'s traceback-tail
  echo is genuinely redundant specifically for the traceback case.
- **Two diagnostics-lifecycle gaps deferred from 4d** (flagged in `PR #83`'s
  review): `RunDiagnostics`' `DiagnosticCollection` is only ever cleared by the
  *next run* of the same file — not on document close, profile sign-out, or a
  run-target flip to Local; and `RevealFrameMessage` carries only a frame
  index, no per-run token, so a delayed `revealFrame` can in principle resolve
  against a later run's frame data (a wrong-line jump, not the "silent no-op"
  the message type is supposed to guarantee).

*Small* — all four are already documented and narrowly scoped; the work here is
implementing (or, for the cert escape hatch, first deciding) each, not
diagnosing.

*Exit:* unchanged — **v0.1.0 published.** A user can install from the
marketplace and run Python on Viya.

---

Everything above is the product. Everything below is breadth, and each phase is
independently valuable and independently shippable. Order is a recommendation,
not a dependency chain — reprioritise based on what users actually ask for once
v0.1.0 is in their hands.


---

## Runbook

_Scoped 2026-09-02, before any code was written — technical grounding (what
already exists vs. genuinely greenfield) came from a codebase survey done the
same session; see each item below for what it found. **Recommended execution
order: 5d → 5a → 5b → 5c.** 5d's four items are already fully diagnosed and
narrowly scoped, and clearing them first retires the scratch-file debt before
anything else; 5a and 5b are audits/small scaffolding, both smaller than the
original plan assumed; 5c is the largest slice and naturally lands last, since
it documents and packages the finished v0.1.0 feature set rather than
preceding it. Nothing here is a hard technical dependency — this is a
recommendation, not a barrier._

☐ **5d — Deferred hardening carried over from Phase 3/4.** Four independent
items, each small enough to land in one PR, or grouped as one if the diffs
don't collide:

1. **Certificate escape hatch.** Decide whether an incomplete certificate
   chain needs a user-facing workaround (compare the SAS extension's own
   handling), and implement it if so; otherwise document explicitly why none
   is needed, so this doesn't come back a third time as an open question.
2. **BOM fixture.** Add an `EF BB BF`-prefixed case to the submission-fidelity
   corpus (3a's fixtures under `test/fixtures/`), confirming upload +
   `infile=` handles a BOM'd file correctly — or documents the gap if it
   doesn't.
3. **Finding 74's two sub-findings** (`src/backend/outputChannel.ts` or its
   test-visible surface — confirm the exact module before starting): decide
   which of (a) suppressing/relabelling the interpreter banner and `>>>`
   markers on the error path and (b) trimming `writeOutcome`'s redundant
   traceback-tail echo for the traceback case specifically actually gets
   fixed here, since 4c left both as undecided rather than rejected.
4. **Diagnostics-lifecycle gaps.** Clear `RunDiagnostics`'
   `DiagnosticCollection` (`src/run/diagnostics.ts`) on document close, on
   profile sign-out, and on a run-target flip to Local — not only on the next
   run of the same file. Add a per-run token to `RevealFrameMessage`
   (`resultPanelModel.ts`/`resultPanel.ts`) so a `revealFrame` message queued
   before a new run started can't resolve against that new run's frame data.

☐ **5a — Drift gate hardening.** Audit `scripts/check-contracts.mjs` against
three specific gaps found in this session's grounding survey, rather than a
general re-read: (1) does the checker notice a contract pointing at a fixture
directory that exists but is empty or stale; (2) does it flag a fixture
directory under `test/fixtures/` that no contract references; (3) is the doc
comment's `path`/`via` XOR rule — declare exactly one, never both, never
neither — actually exercised by negative-case tests for both the "declares
both" and "declares neither" arms. Harden the checker for whatever this audit
finds, then confirm `npm run verify`'s existing CI wiring still passes
unchanged — no new CI wiring is expected, since that half is already done.

☐ **5b — Live test tier.** Add a `viya35` scaffold under `test/live/`: one
file establishing the pattern (a minimal read-only probe, gated on
`liveTarget("viya35")`) that reports a clean skip on a machine with no
`PYTHON_ON_VIYA_TEST_VIYA35_*` pair set, mirroring the shape of the three
existing viya4 suites. Separately, audit whether those three existing viya4
suites still cover what Phase 3/4 actually shipped since they were written —
Findings 75/76's cancel behaviour, 4c/4d's traceback-to-diagnostics mapping —
or whether a live-coverage gap has opened there too. Document `npm run
test:live` usage for a maintainer with real credentials, either in
`docs/dev/testing.md` or a new `docs/dev/live-testing.md`.

☐ **5c — Docs publishing and release engineering.**

1. New user-facing docs pages for Phase 3/4's shipped feature set: running
   Python (Run File/Selection, live output streaming), diagnostics (Problems
   panel entries, click-to-jump from the result panel), cancel behaviour
   (including Findings 75/76's caveat that a cancel doesn't preempt an
   already-running Python statement), and environment info (Show/Refresh
   Environment). Register each in `.vitepress/config.mjs`'s `nav`/`sidebar` —
   an unregistered page builds without complaint per `docs/README.md`'s own
   warning.
2. A troubleshooting guide assembled from what actually went wrong during
   Phases 1–4 — source material is the phase files' own Probe findings
   sections and `STATUS.md`'s incident record, not a generic FAQ.
3. Marketplace metadata: an icon asset, flipping `package.json`'s `"private"`
   to `false`, bumping `version` to `0.1.0` (in the release PR itself, per
   `docs/release-checklist.md`'s D1/D2 — not before), README screenshots/GIFs.
4. The publishing workflow itself (VS Marketplace + Open VSX) that
   `docs/release-checklist.md`'s D5 already assumes exists — it doesn't yet.
5. Exercise `docs/release-checklist.md` end to end at least once, as a dry
   run, before the real v0.1.0 tag.

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
