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
items. Being taken as three PRs (Sean's call, 2026-09-02): **5d-i** (item 1)
alone, then item 2, then item 3, then item 4 — item 1 turned out to be a real
`src/` change rather than the docs decision the Plan anticipated, so it does not
group with the test-only BOM fixture.

1. ~~**Certificate escape hatch.** Decide whether an incomplete certificate
   chain needs a user-facing workaround (compare the SAS extension's own
   handling), and implement it if so; otherwise document explicitly why none
   is needed.~~ **Done — slice 5d-i, merged 2026-09-02 as
   [PR #88](https://github.com/Shai-Alit/sas-py-vscode/pull/88), squashed as
   `331bcf3`.** The Plan's premise was wrong on inspection: the SAS
   extension *does* ship a user-facing escape hatch — `SAS.userProvidedCertificates`
   (`client/src/components/CAHelper.ts`'s `installCAs()`) plus a documented FAQ
   procedure — so "the way the SAS extension needs none" does not hold, and an
   incomplete chain / private-root deployment is genuinely unreachable here
   today. This slice is the scoped implementation of the long-deferred **1c-ii**
   (`docs/phases/phase-1.md`): a `machine`-scoped `pythonOnViya.userProvidedCertificates`
   array, `src/auth/caAgent.ts`'s `buildCaAgent` building **one dedicated
   `https.Agent`** (Node's bundled roots + the user's PEMs) — never
   `https.globalAgent`, upstream's process-global write — `src/auth/transport.ts`
   gaining `createNodeHttpTransport({ agent })` with `nodeHttpTransport`
   unchanged as its zero-config form, and `src/extension.ts` threading the
   resulting transport through both the auth provider and the compute session
   manager. Unreadable paths are logged (not swallowed — upstream `console.log`s
   them). `caAgent.ts` is the fourth entry on `eslint.config.mjs`'s
   Node-built-in allow-list — the "certificate module" ADR-0003's hedge always
   named; ADR-0003 and ADR-0008 both amended 2026-09-02. `docs/signing-in.md`
   gains a "Private certificate authorities" section; `manual-test-pass.md` §3
   gains a live row (unrun — needs a deployment whose chain the OS does not
   already trust).

   **Evidence for two host-behaviour claims the code comments and user docs
   make** (`microsoft/vscode-proxy-agent` `src/index.ts`, read 2026-09-02):
   `createHttpPatch` computes `addCertificatesV1 = !optionsPatched &&
   params.addCertificatesV1() && isHttps && !originalCa` — so the moment a
   request carries a `ca` (from our agent), VS Code stops merging the OS
   certificate store into it; the user docs say the list must therefore be
   complete. And under the default `http.proxySupport: "override"`, for a
   non-localhost host, the patch installs its own `PacProxyAgent` with
   `originalAgent: undefined` and does `options.ca = originalCa` — hoisting our
   agent's `ca` while discarding the agent instance. So the CA trust is
   honoured but the `Agent` object may not open the socket; `keepAlive` and any
   future non-`ca` option on it take effect only when no patch runs
   (`proxySupport: "off"`, or a loopback target). The unit test
   "hands an https request to the agent it was given" is a boundary test of our
   own code, not of that host path; the live `manual-test-pass.md` §3 row is
   what would confirm end to end, and it is unrun.
2. ~~**BOM fixture.** Add an `EF BB BF`-prefixed case to the submission-fidelity
   corpus (3a's fixtures under `test/fixtures/`). De-risked by Finding 77
   (below): a live probe already confirmed the upload + `infile=` path runs
   a BOM-prefixed file cleanly, so this is "add the case, assert success",
   not an open investigation.~~ **Done — slice 5d-ii, 2026-09-02.** New
   `test/fixtures/submission-corpus/utf8-bom.py`
   (three `EF BB BF` bytes + `print("byte-order mark before this line")\n`, 45
   bytes) — BOM immediately followed by ASCII, the simplest case Finding 77 said
   a fixture needs. Added to `EXPECTED_CASES` in
   `test/unit/submission-corpus.test.ts`, so the existing "what reaches the
   transport" loop drives it byte-for-byte for free; a new "the fixtures
   themselves" assertion pins the leading three bytes, that there is no
   second BOM later in the file, and that real `print(` source follows the mark
   (so a file truncated to just its three BOM bytes cannot pass silently).
   `.editorconfig`'s corpus block gains
   `charset = unset` — the repo-wide `charset = utf-8` means "no BOM" to the
   EditorConfig spec, so an editor honouring it would strip the mark on save,
   the same failure class `.gitattributes` `-text` already guards against for
   the CRLF and no-trailing-newline cases. Enumerations updated in
   `PRODUCTION_PLAN.md` §4, `test/fixtures/README.md`, and
   `docs/dev/manual-test-pass.md` §6's corpus grid (with a note that the
   2026-08-27 run predates this case and Finding 77 covers its live
   behaviour). **`test/live/submission-corpus.test.ts`'s `CURATED_CASES` left
   unchanged** — a deliberate call: that tier is deliberately capped at five
   maximally-distinct cases, four requests each against a real deployment, and
   Finding 77 already exercised the live BOM path directly; the unit tier is
   the permanent regression guard the runbook item asked for. Test-only, no
   `src/` change.

   **Scope note — what this fixture pins.** It pins the *transport* seam
   (`PRODUCTION_PLAN.md` §4's charter for the corpus: every byte reaches
   `HttpTransport` unchanged), not the editor→bytes seam. On the real Run File
   path `program.bytes` is `new TextEncoder().encode(document.getText())`
   (`src/run/commands.ts:396`/`:404`), and VS Code's `getText()` has already
   consumed any BOM as encoding metadata — so a BOM'd file *opened in the
   editor* most likely never produces a leading BOM in `program.bytes` at all.
   This fixture and Finding 77 together establish that the fileref upload path
   and this deployment both tolerate a leading BOM *if one is ever sent*; they
   do not claim the editor sends one. `procPython.ts:937` uploads
   `program.bytes` verbatim with no wrapping or prologue, so the fixture is
   testing the seam it claims.

   **Review:** one adversarial pass, 2026-09-02, **in this session** — not the
   separate VS Code Claude Code window this project's standing review policy
   names. It read the full `a852504` diff plus `.gitattributes`,
   `test/helpers/fixtures.ts`, the live corpus suite, `procPython.ts`'s upload
   path and `scripts/check-copyright.mjs`. No P0/P1. Three findings, all
   verified independently here and folded into a follow-up commit on the
   branch: (1, P2) the live suite's doc comment still said "not all fourteen" —
   corrected to fifteen, the sweep this project's evidence rule requires in the
   same PR; (2, P3) the new fixture assertion did not pin that anything follows
   the BOM — the `print(` check above was added; (3, P3, claim accuracy) the
   scope note above, so the next reader does not over-read the fixture as
   modelling the editor path. Several deliberate choices were checked and
   stand: `charset = unset` (not `utf-8-bom`, which would have demanded a mark
   on all fifteen files and destroyed `empty.py`), the licence-header omission
   (`check-copyright.mjs` only scans `.ts` under `test/`), and the
   `CURATED_CASES` decision.

   **Verified green 2026-09-02 (Sean's run):** `npm run verify`, `npm run
   check:docs` and `npm run test:integration` all pass on the post-review
   branch. **Merged 2026-09-02 as
   [PR #89](https://github.com/Shai-Alit/sas-py-vscode/pull/89), squashed as
   `e08e55f`.** Its `supply-chain` CI job surfaced six unrelated dev-tree
   advisories (`qs`, `fast-uri`, transitive under `@vscode/vsce`); cleared in
   the same PR by `overrides.qs ^6.16.0` / `overrides.fast-uri ^3.1.6` — see
   `STATUS.md` for the full account.
3. ~~**Finding 74's two sub-findings** (`src/backend/outputChannel.ts` or its
   test-visible surface — confirm the exact module before starting): decide
   which of (a) suppressing/relabelling the interpreter banner and `>>>`
   markers on the error path and (b) trimming `writeOutcome`'s redundant
   traceback-tail echo for the traceback case specifically actually gets
   fixed here, since 4c left both as undecided rather than rejected.~~
   **Done — slice 5d-iii, 2026-09-02.**

   **Module confirmed:** the Plan's `src/backend/outputChannel.ts` path does
   not exist. The real module is `src/run/outputChannel.ts` (test-visible
   through `test/integration/run/output-channel.test.ts`, a hand-rolled
   `vscode.OutputChannel` double). Sub-finding (b) also has a root-cause site
   one layer down, in `src/backend/procPython.ts`'s `parseTraceback`.

   **Decision: (b) is fixed on both outcome surfaces; (a)'s live-transcript
   half is deliberately not.**

   - **(b) — the echo.** A shared pure helper
     `alreadyStreamedAsTraceback(message, streamedTraceback)`
     (`src/backend/tracebackDiagnostics.ts`) answers "did the user already see
     this text stream?" — true only when the diagnostic's message equals the
     streamed `Traceback`'s own message. Both `RunOutputChannel.writeOutcome`
     (`src/run/outputChannel.ts`) and `ResultPanel.writeOutcome`
     (`src/run/resultPanel.ts`) now take the streamed `Traceback` (captured by
     `commands.ts`'s `drainOutputs`, in scope at the call site) and drop a
     matching diagnostic before rendering the outcome. Value-equality, not a
     blanket failure-path suppression, and the helper returns **false** — so
     the line still prints — for three cases that never streamed: a SAS-side
     error (`SYSCC=3000`, from `SYSERRORTEXT`); the synthesized
     `SYNTHESIZED_TRACEBACK_MESSAGE` ("an unhandled Python exception")
     stand-in `parseTraceback` uses when a header and frames are followed by
     no exception line (`buildFailureOutcome` puts that one string on both
     sides, so a plain equality check alone would wrongly suppress it — the
     carve-out is why the helper exists rather than an inline `===`); and a
     `ModuleNotFoundError`, whose diagnostic is a strict superset of the
     streamed message (`withModuleNotFoundGuidance`'s "Show Environment"
     pointer appended). That last one prints in full — one repeated tail then
     the pointer; slicing off the known prefix was considered and left out
     because the equality check fails safe where a prefix-slice would emit a
     fragment, noted as a possible follow-up.
   - **The result panel mattered more than first scoped.** For a failing run
     the panel already holds the traceback text *twice* — as the raw log's
     `text/plain` items and as the structured, clickable traceback item — so
     the outcome's own diagnostics list was a third copy. An earlier draft
     deferred this as "out of scope"; the adversarial pass (below) showed it
     was the same one-line fix and a measurable triple-render, so it is closed
     here too.
   - **Paired backend cleanup.** `parseTraceback` was sweeping the
     interpreter's bare `>>>` / `...` prompt lines — which `PROC PYTHON`
     brackets a failing run's traceback with, typed `normal`, so `logFilter.ts`
     correctly forwards them — into `traceback.message`. It now trims a run of
     them from **each end** of the message tail, never the interior (a real
     exception message can embed a REPL or doctest transcript; a numpy
     row-elision line trims to exactly `...`). Matched as a whole trimmed line,
     never a substring, so `raise Exception(">>>")` → `Exception: >>>` is
     untouched. Cleans the message for every consumer — the echo comparison,
     the diagnostic, the Problems-panel entry, the panel.
   - **(a) — banner + `>>>` in the live transcript: not fixed, by design.**
     These lines arrive typed `normal`; `logFilter.ts`'s whole documented
     rationale (findings 52, 63) is "trust the type, never reconstruct
     classification by text-scanning, show the unknown — hiding-by-default
     fails unsafe." A client-side regex scrub of `normal` output contradicts
     that, and bare `>>>` genuinely collides with legitimate program output
     (a REPL transcript, doctests, a tutorial). The banner/`>>>` appear *only*
     on the error path — successful runs are already clean — which points at a
     `PROC PYTHON` invocation-mode question that needs a live deployment to
     investigate, not a papered-over client hack. Left open as a **probe
     follow-up**; `phase-3.md`'s Finding 74 entry carries the same note.

   **Landed:** `src/backend/tracebackDiagnostics.ts`
   (`SYNTHESIZED_TRACEBACK_MESSAGE` + `alreadyStreamedAsTraceback`),
   `src/backend/procPython.ts` (`PROMPT_LINES` end-trim, uses the constant),
   `src/run/outputChannel.ts` and `src/run/resultPanel.ts` (`writeOutcome`
   gains the streamed-`Traceback` arg + the guard), `src/run/commands.ts` (one
   line — passes `traceback` to both). Tests: four `RunOutputChannel` cases,
   two `ResultPanel` cases, four `alreadyStreamedAsTraceback` cases, and four
   `proc-python-backend.test.ts` cases (end-trim; interior prompt kept; `>>>`
   inside a real message kept; synthesized fallback produced). `npm run
   verify` green (exit 0, coverage ratchet held — `tracebackDiagnostics.ts`
   100%, `src/run` 100%); `npm run test:integration` green (237 passing).

   **Review:** one full adversarial pass, 2026-09-02, in the separate review
   window this project's standing policy names. No P0/P1. Findings folded into
   a follow-up commit on the branch: (P2) the synthesized-fallback string was
   suppressible by the echo guard — fixed with the `SYNTHESIZED_TRACEBACK_MESSAGE`
   carve-out in the shared helper; (P2) `PROMPT_LINES` filtered interior lines
   where the defect is strictly at the tail's ends — restricted to leading/
   trailing runs, with a test for an interior prompt; (P2) the result-panel
   triple-render was hedged as "(if any)" — measured, confirmed, and closed
   with the same guard rather than deferred; (P3) superseded pointers in
   `phase-4.md`'s 4c entry, `STATUS.md`'s phase index, and
   `manual-test-pass.md` swept in this same commit; (P3) CHANGELOG wording and
   doc-comment precision nits. The reviewer's "checked and sound" list
   confirmed fail-open on every branch, no false-positive dedup, and that the
   `lastIndexOf`/leading-`<stdin>`-trim/`FRAME_PATTERN` logic is untouched by
   the tail-only change.

   **Environment note (not a code change):** `npm run test:integration` fails
   at VS Code launch (`Code.exe: bad option: --disable-extensions`) when run
   from a shell spawned inside the VS Code extension host, because the host
   exports `ELECTRON_RUN_AS_NODE=1` (plus other `VSCODE_*` vars) into every
   child, so `@vscode/test-electron` launches `Code.exe` as bare Node. Ran
   green here by stripping those vars for the one command. Worth a harness fix
   (unset them in `runTest.js`) in a later infra slice.
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

Probed 2026-09-02 against `verde` (Viya 4), SAS Studio compute context, via
the `viya-api-probe` skill against `creds.json`. Continues the numbering from
`phase-4.md` (last was Finding 76).

### Finding 77 — A UTF-8 BOM in the uploaded file does not break `PROC PYTHON infile=`

Run to de-risk 5d's BOM-fixture item before writing it, since no prior probe
in any phase file had ever actually put a byte-order mark through the
upload path. A throwaway session was created on the SAS Studio compute
context and deleted at the end, confirmed gone by a `404` read-back;
nothing else was touched.

Reproduced the exact path `procPython.ts` composes: a fileref (`bomtest1`)
created via `assign`, a fresh `self` `GET` for an `ETag` (`fileref.ts`'s own
two-request discipline), then its `upload` `PUT` with that `ETag` as
`If-Match` and `Content-Type: application/octet-stream` — carrying the
three-byte UTF-8 BOM (`EF BB BF`) immediately followed by
`print("bom-ok")\n`, confirmed byte-for-byte on the wire before sending. Ran
`proc python infile=bomtest1;` + `run;`, exactly as `procPython.ts:947-948`
and `:965-969` compose it.

**Measured: it runs clean.** The job reached `completed`, `SYSCC` read back
`0`, and the job log shows the ordinary interpreter banner, `bom-ok` on its
own line with nothing garbled before or after it, and no `SyntaxError` or
traceback anywhere in the log. Whatever this deployment's `PROC PYTHON` (or
the CPython 3.12.12 it embeds) does with a leading BOM, it tolerates it the
same way CPython's own source-encoding detection tolerates one when reading
a `.py` file directly — ADR-0014's byte-for-byte upload discipline is not
put in a bind by a BOM the way it is by, say, `endsubmit;` appearing in a
string.

**One correction to the session's own `POST` recipe, found in the course of
this probe and worth recording since it will bite the next person who
copies `contracts/viya4.yaml` literally:** the `createSession`/`assign`/etc.
link's `type` field arrives on the wire *without* its `+json` suffix
(finding 14), and `computeMediaType` in `src/compute/links.ts` puts it back
before ever sending a request — `src/compute/client.ts:293/296` calls it for
every `Content-Type` header this codebase sends. A first attempt at this
probe sent the bare `application/vnd.sas.compute.session.request` (copied
straight from the link and from `contracts/viya4.yaml`'s own `via.type`
field) and drew a `415` naming the missing "representation suffix" in as
many words. Not a new finding about the deployment — `computeMediaType`
already existed for exactly this reason — but a reminder for anyone probing
by hand that the contract file's `type:` values are the *wire* value, not
the header value, and the two are only the same for `session_cancel`/
`session_delete`/`job_cancel` because those are `null`.

**Not settled by this probe:** whether a BOM combined with an explicit
`# -*- coding: ... -*-` declaration, or a BOM appearing mid-file rather than
at byte 0, behaves the same — this probe used the simplest case a BOM
fixture needs (BOM immediately followed by ASCII). Good enough to write
5d's fixture as "add the case, assert success" rather than "add the case,
investigate what happens" — the fixture itself, once it exists, is what
keeps this true across whatever the deployment upgrades to next.
