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

☑ **5d — Deferred hardening carried over from Phase 3/4. Done — all four
items merged**, one PR each (Sean's call, 2026-09-02): **5d-i**
([PR #88](https://github.com/Shai-Alit/sas-py-vscode/pull/88)), **5d-ii**
([PR #89](https://github.com/Shai-Alit/sas-py-vscode/pull/89)), **5d-iii**
([PR #92](https://github.com/Shai-Alit/sas-py-vscode/pull/92)), **5d-iv**
([PR #94](https://github.com/Shai-Alit/sas-py-vscode/pull/94), squashed as
`b03a92d`). Item 1 turned out to be a real `src/` change rather than the docs
decision the Plan anticipated, so it did not group with the test-only BOM
fixture.

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
   **Done — slice 5d-iii. Merged 2026-09-02 as
   [PR #92](https://github.com/Shai-Alit/sas-py-vscode/pull/92), squashed as
   `b9b18ef`.**

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

   **PR bot review (non-blocking):** the `github-actions` reviewer flagged
   that the end-trim's doc comment overstated boundary safety — a multi-line
   exception message whose *own* first or last physical line is exactly
   `>>>` / `...` (e.g. `raise ValueError("x\n...")`) loses that line, the
   same ambiguity the comment only called out for the interior. The unbounded
   trim is kept — `PROC PYTHON`'s error-path prompt emission is irregular
   (runs of `>>>`, not always one), and a marker left glued to the message is
   the defect being closed — but the comment now owns the tradeoff and a new
   `proc-python-backend.test.ts` case pins the accepted loss.

   **Verified live 2026-09-02** against `verde` with a `.vsix` from the branch
   (Sean's run) — **ten runs**, five scripts × **Run Selection** and **Run
   File**:

   - bare recursion — output channel ends at `Finished with an error.` with
     **nothing after it**; structured message `[Previous line repeated 995
     more times] RecursionError: maximum recursion depth exceeded`, no
     trailing `>>>`, no third copy in an outcome line;
   - `raise ValueError("boom")` — full dedup, **no outcome bullet**;
   - `import nosuchpkg` — the superset case: `ModuleNotFoundError: … Run
     "Python on Viya: Show Environment" …` still prints after the outcome
     line (helper returns `false`), structured message is Python's own text
     with no pointer and no `>>>`;
   - `print(">>> …")` / `print("...")` then `raise` — **no over-reach**: both
     `print` lines survive verbatim in the stream, message is `RuntimeError:
     done` only;
   - figure written then `raise` — rich-output capture still runs on the
     failure path; panel = raw log + structured traceback + PNG +
     `Finished with an error.` with no bullet;
   - successful run — `Finished.` alone.

   Run Selection and Run File matched on every case. The
   synthesized-fallback and SAS-side-`SYSERRORTEXT` sub-cases stay unit- and
   integration-covered (not hand-forceable).

   The `[Previous line repeated N more times]` prefix on the structured
   message is **pre-existing** `parseTraceback` behaviour (any post-frame
   line that is not itself a frame joins the message) — not touched or
   regressed here, arguably wanted since it is real traceback content; a
   follow-up could move it out of `message` if it ever reads as noise.

   **Sub-finding (a), refined by this pass:** the noise has two distinct
   triggers, and **neither is "the error path"** as Finding 74 first
   recorded. The interpreter banner (`Python 3.12.12 … / Type "help" …`)
   tracks the **`restart`** the Run File path issues — it shows on a
   *successful* Run File run too (run 6, Run File). Bare `>>>` markers show
   on **every** run of either launch mode, success or failure. Consequence:
   §6's "Hello world streams clean" (`no page-break banners, no >>> markers`)
   **does not currently hold for Run File** — `manual-test-pass.md` §6's
   box carries the contradiction note. All of this is stream content 5d-iii
   never touches; it is the live-Viya probe's to resolve source-side (the
   way `PAGESIZE=MAX` resolved the `title` page-break banner), not a
   client-side scrub of `normal`-typed lines.

   **Environment note (not a code change):** `npm run test:integration` fails
   at VS Code launch (`Code.exe: bad option: --disable-extensions`) when run
   from a shell spawned inside the VS Code extension host, because the host
   exports `ELECTRON_RUN_AS_NODE=1` (plus other `VSCODE_*` vars) into every
   child, so `@vscode/test-electron` launches `Code.exe` as bare Node. Ran
   green here by stripping those vars for the one command. Worth a harness fix
   (unset them in `runTest.js`) in a later infra slice.
4. ~~**Diagnostics-lifecycle gaps.** Clear `RunDiagnostics`'
   `DiagnosticCollection` (`src/run/diagnostics.ts`) on document close, on
   profile sign-out, and on a run-target flip to Local — not only on the next
   run of the same file. Add a per-run token to `RevealFrameMessage`
   (`resultPanelModel.ts`/`resultPanel.ts`) so a `revealFrame` message queued
   before a new run started can't resolve against that new run's frame
   data.~~ **Done — slice 5d-iv, merged 2026-09-03 as
   [PR #94](https://github.com/Shai-Alit/sas-py-vscode/pull/94), squashed as
   `b03a92d`.** This closes both gaps `phase-4.md`'s 4d entry deferred here,
   and with it all four of 5d.

   **(a) — clearing the Problems collection.** `RunDiagnostics` gains
   `clearAll()` (`collection.clear()`), the collection-wide counterpart to
   `clearFor`. `createRunCommandHandlers` (`src/run/commands.ts`) wires the
   three new triggers — the one place the "when to clear" now lives, so one
   integration suite covers it:
   - **run target flipped to Local** — the existing `targets.onDidChange`
     subscription, now gated `if (targets.kind() === "local")
     diagnostics.clearAll()`. A viya→viya profile switch fires the same event
     and is deliberately left alone: a run against the new profile could still
     be about the same code, and nothing here can tell whose entry it was.
   - **document close** — a new subscription to
     `vscode.workspace.onDidCloseTextDocument` → `clearFor(document.uri)`.
     Unconditional — `clearFor` on a URI with no entry is a documented safe
     no-op, so no `languageId`/`scheme` filter. Injectable as
     `RunCommandDeps.onDidCloseTextDocument` (defaulting to the real event),
     matching the rest of `RunCommandDeps`' "a test cannot close a real
     editor" rationale. `onDidCloseTextDocument` also fires on a language-id
     change (VS Code's own API note), so a file switched out of Python mode
     clears its entry too — fine, it is no longer a Python file.
   - **profile sign-out** — a new `RunCommandDeps.onDidSignOut` event →
     `clearAll()`, fed by a **new `ViyaAuthenticationProvider.onDidSignOut`**
     that fires only from `removeSession` (the palette `Sign Out` command and
     the Accounts menu both route through it, nothing else does). The first
     draft derived this from the `auth.onDidChangeSessions` listener
     `extension.ts` already runs, but the review pass caught that `removed`
     there is a *diff* of the published session list — it also fires for a
     profile a slow renewal or an unreadable keychain entry dropped for one
     poll (`allSessions`/`within`), which would wipe the Problems panel on
     transient network weather. `forgetProfile`, the diff's other consumer,
     tolerates a false positive (the backend reconnects); `clearAll` does not,
     so it gets its own deliberate-only signal.

   All three subscriptions are torn down in `createRunCommandHandlers`'
   existing `dispose()`.

   **(b) — the per-run token.** `resultPanel.ts` gains `currentRunToken`, a
   monotonic counter bumped in `startRun` (starts at 0, so the first run's
   token is 1; a message can only echo a token a real traceback item carried,
   and `revealFrame`'s `currentOrigin` guard covers the no-run-yet case where
   the counter is still 0). It is stamped onto the
   traceback `RenderItem` (`toRenderItem` gains a `runToken` parameter) rather
   than kept as transient webview state — so it survives the panel's
   `retainContextWhenHidden: false` hide/show rebuild and full backlog replay
   for free, because the replayed `output` message carries it. `resultPanelDom.ts`
   passes `(frameIndex, runToken)` to `onFrameActivate`; `src/webview/entry.ts`
   echoes both in the `revealFrame` message; `RevealFrameMessage` and
   `isRevealFrameMessage` gain `runToken` (validated as a non-negative
   integer, like `frameIndex`); `ResultPanel.revealFrame` drops a message
   whose token is not `currentRunToken` before any origin/frame lookup. The
   `"reset"` message is left unchanged — the token only needs to reach the one
   message the webview sends back.

   **Correction to `phase-4.md`'s 4d note.** That note said a per-run token
   would close "(b) and the two-`<ol>`s-in-one-run case together." It closes
   (b). It does *not* close the two-`<ol>` alias — one run is one token, so
   two tracebacks in a single run would share it — but that case stays
   structurally impossible upstream: `procPython.ts`'s `buildFailureOutcome`
   emits exactly one `application/vnd.python.traceback` per run.
   `resultPanel.ts`'s `currentFrames` doc comment and `phase-4.md`'s note are
   both updated to say so.

   **Landed:** `src/run/diagnostics.ts` (`clearAll`), `src/run/commands.ts`
   (`RunCommandDeps.onDidCloseTextDocument`/`onDidSignOut`, the three
   subscriptions), `src/auth/authProvider.ts` (new `onDidSignOut`, fired from
   `removeSession`), `src/extension.ts` (wires `auth.onDidSignOut` through to
   the run commands), `src/run/resultPanelModel.ts` (`runToken` on the
   traceback `RenderItem` and `RevealFrameMessage`, both guards),
   `src/run/resultPanelDom.ts` (`onFrameActivate` arity), `src/webview/entry.ts`
   (echo the token), `src/run/resultPanel.ts` (`currentRunToken`, the drop).
   Tests: `result-panel-model.test.ts` (token threaded through `toRenderItem`,
   both guards' new arms), `result-panel-dom.test.ts` (`onFrameActivate` gets
   the token), `result-panel.test.ts` (a superseded-token `revealFrame` is
   dropped, the current one still resolves), `commands-diagnostics.test.ts`
   (all three clear triggers, plus the viya→viya negative),
   `diagnostics.test.ts` (`clearAll` across two URIs), `auth-provider.test.ts`
   (`onDidSignOut` fires on a deliberate sign-out, not on a vanished-session
   diff). Docs:
   `docs/architecture/diagnostics-surface.md` (new "Lifecycle" section),
   `phase-4.md`'s 4d deferred note (resolved pointer + the correction),
   `CHANGELOG.md`, `docs/dev/manual-test-pass.md` §7/§8.

   **Checks:** `npm run verify` green (1191 passing; coverage
   94.22/95.16/93.78/94.22, all above the `.c8rc.json` floors — no ratchet
   move) and `npm run test:integration` green (Sean's runs).

   **Review:** one adversarial pass, 2026-09-02, in the separate VS Code
   Claude Code window. No P0/P1. Six findings, all verified independently and
   folded in: **(1, P2)** the sign-out clear was derived from
   `onDidChangeSessions`'s `removed`, which is a diff of the published list and
   also fires when a slow renewal or an unreadable keychain entry drops a
   profile for one poll — a transient condition that would have wiped the
   Problems panel. Fixed by adding `ViyaAuthenticationProvider.onDidSignOut`,
   fired only from `removeSession` (both deliberate sign-out routes go through
   it), and consuming that instead; the `extension.ts` `EventEmitter` bridge
   is gone. **(2, P3)** `onDidCloseTextDocument` also fires on a language-id
   change — comment amended to own that (a file leaving Python mode clearing
   its entry is correct). **(3, P3)** the `currentRunToken` doc comment and
   `phase-5.md` both claimed "a token-0 message never matches"; it does match
   the pre-first-run counter and is stopped by the `currentOrigin` guard —
   both corrected. **(4, P3)** the sign-out rationale leaned on "a run only
   ever targets the active one," which argues the other way; restated as "an
   entry carries no profile tag, so there is nothing finer to clear."
   **(5, P3)** `isRenderItem` accepted any `number` for `runToken` while
   `isRevealFrameMessage` demanded a non-negative integer — aligned, with the
   negative test extended. **(6, P3, test)** `sendRevealFrame`'s `?? 0`
   fallback masked a missing `sendReady()`; it now throws when no token is
   derivable. The reviewer also recorded two checks that held: `setKind`
   awaits its `workspaceState` write before firing, so `targets.kind()` in the
   handler is never stale; and the token genuinely survives the panel rebuild
   because `emit` clears the backlog on `"reset"`.

   **Verified live 2026-09-03** against `verde` with a branch `.vsix` (a first
   run used a stale build; a window reload sorted it). All three clears in §7's
   new row hold — close the file's editor tab, **Sign Out**, and flip the run
   target to Local each drop the Problems entry; reopen and switch-back leave
   it gone; a viya→viya profile switch leaves it in place. `manual-test-pass.md`
   §7 ticked. A PR-bot nit on the open PR — `phase-4.md`'s deferral note
   contradicted itself after the "resolved" prepend — was folded in (reworded
   to past tense). **Merged 2026-09-03 as
   [PR #94](https://github.com/Shai-Alit/sas-py-vscode/pull/94), squashed as
   `b03a92d`.**

☑ **5a — Drift gate hardening.** Audit `scripts/check-contracts.mjs` against
three specific gaps found in this session's grounding survey, rather than a
general re-read: (1) does the checker notice a contract pointing at a fixture
directory that exists but is empty or stale; (2) does it flag a fixture
directory under `test/fixtures/` that no contract references; (3) is the doc
comment's `path`/`via` XOR rule — declare exactly one, never both, never
neither — actually exercised by negative-case tests for both the "declares
both" and "declares neither" arms. Harden the checker for whatever this audit
finds, then confirm `npm run verify`'s existing CI wiring still passes
unchanged — no new CI wiring is expected, since that half is already done.

**Audit outcome (2026-09-03):**

- **Gap (1) — empty:** real, and now fixed. `checkOne` only tested that the
  directory *existed*. `readScope` now computes `emptyFixtureDirs` — directories
  that exist but hold nothing but dotfiles — and `check` gains an
  `emptyFixtureDirs` parameter so the decision stays in the pure function and
  the unit tier can state it as a case (a review finding: the first draft put
  the emptiness filter in `readScope` alone, where no unit test could reach it).
  An empty directory gets its own message, distinct from "does not exist",
  mirroring `unionMembers`' "not found" vs. "unreadable" split.
  `test/fixtures/viya35/` (one README, no payloads) still passes — a README is
  the documented minimum.
- **Gap (1) — stale:** left unaddressed, deliberately. "Stale" means recorded
  payloads that no longer match the wire, which only a live probe settles —
  `docs/architecture/contracts.md` already says this gate "checks structure, not
  truth", and fixtures/probes cover drift. Recorded here so a ticked box does
  not read as if both halves of gap (1) were mechanised.
- **Gap (2):** real, no general form. A blanket "every directory needs a
  contract" would wrongly flag `harness/`, `submission-corpus/` and
  `rich-output/` — contract-less fixtures by design. Added a narrow reverse
  check: a `test/fixtures/<id>/` whose name is a `DialectId` while *that
  generation's* contract points `fixtures` at *another directory that itself
  exists* (the rename-orphan). Scoped so a generation with no contract stays
  direction 2's report, and a contract whose `fixtures` is missing, empty, or a
  plain typo pointing nowhere real stays `checkOne`'s single complaint — no
  double report (the `fixtureDirs.includes(declared)` guard was tightened in
  response to a PR #97 review comment; the first cut only excluded the
  non-string case). A leftover renamed *away from* a generation name keeps no
  toehold and is not caught; accepted and documented.
- **Gap (3):** found already closed. Both negative arms in
  `test/unit/contracts.test.ts` — `refuses both a path and a via` and
  `refuses neither a path nor a via` — predate this slice and assert their
  specific messages. Added the one adjacent hole while confirming: a positive
  `accepts a via with no path` (the path-only positive already existed).

**Also folded in from the review pass (2026-09-03):** the new `readdirSync` sits
inside a guarded `listFixtureDirs` helper (replacing `listDirectories`), so a
directory that vanishes mid-run drops out rather than throwing a stack trace out
of the gate; dotfiles (`.gitkeep`) do not count as content; `run()` in the test
gained optional `fixtureDirs`/`emptyFixtureDirs` params so two cases no longer
need a hand-built `check` call; `docs/architecture/contracts.md`'s assertion
table and prose updated (the fixtures row's reverse cell was `—`);
`test/fixtures/README.md` gained the missing `rich-output/` row and a note on
which directories the check ties to a contract; `test/fixtures/viya35/README.md`
stopped pointing at the retired `PROBE-FINDINGS.md`.

**Checks:** `npm run verify` green (exit 0; coverage unmoved at the `.c8rc.json`
floors — `scripts/` is outside the `out/src` denominator anyway). Test-tier
count 1191 → 1197. No `src/` change; `test:integration` not warranted (this is a
build-time gate). Reviewed: one adversarial pass in the separate VS Code Claude
Code window (2026-09-03), nine P2/P3 findings, all verified independently and
folded in as above. On PR #97 the two AI reviewers then found two more, both
folded on the branch: Codex — `listFixtureDirs` recorded a directory in `all`
before its own `readdirSync` succeeded, so a mid-run read failure left it
listed as present (fixed: read first, push after); the Claude reviewer — the
reverse orphan check's typo carve-out only covered a non-string `fixtures`, so
a `fixtures:` typo pointing at a nonexistent directory still drew a second,
misworded complaint (fixed: `fixtureDirs.includes(declared)`).

**Merged 2026-09-03 as
[PR #97](https://github.com/Shai-Alit/sas-py-vscode/pull/97), squashed as
`f0e55b8`.** Local `main` fast-forwarded, matches `origin/main`. Nothing
carried over.

☑ **5b — Live test tier. Merged 2026-09-03 as
[PR #99](https://github.com/Shai-Alit/sas-py-vscode/pull/99), squashed as
`a3b89ce`** — local `main` fast-forwarded, matches `origin/main`, working tree
clean. CI + both AI reviewers passed on the final commit (the Major per-run-marker
finding fixed in `9918268`, re-verified live). The `viya35` scaffold's own live
run against a real 3.5 deployment is deferred to the end of Phase 5. Add a
`viya35` scaffold under `test/live/`: one
file establishing the pattern (a minimal read-only probe, gated on
`liveTarget("viya35")`) that reports a clean skip on a machine with no
`PYTHON_ON_VIYA_TEST_VIYA35_*` pair set, mirroring the shape of the three
existing viya4 suites. Separately, audit whether those three existing viya4
suites still cover what Phase 3/4 actually shipped since they were written —
Findings 75/76's cancel behaviour, 4c/4d's traceback-to-diagnostics mapping —
or whether a live-coverage gap has opened there too. Document `npm run
test:live` usage for a maintainer with real credentials, either in
`docs/dev/testing.md` or a new `docs/dev/live-testing.md`.

**Implemented 2026-09-03; not yet verified by review, not yet merged, no PR.**
Test-files-plus-docs only, no `src/` change.

- **`viya35` scaffold — `test/live/viya35-connectivity.test.ts`.** Mirrors
  `viya4-connectivity.test.ts` exactly: `liveTarget("viya35")` in the
  `describe` body, `before` skips the suite when unset, the one `it` calls
  `fetchCurrentUser` and asserts an `id` comes back. Deliberately narrow — no
  compute, no jobs, no `PROC PYTHON` — because this project has still never
  talked to a live 3.5 and `docs/README.md`'s rule bars presenting 3.5 as
  supported from documentation. `/identities/users/@currentUser` is the one
  endpoint the production code already designs around 3.5's unknowns
  (`identity.ts`'s summary→full media-type fallback, finding 6), so the scaffold
  is the first thing that would exercise it live; the doc comment says plainly
  that the first run with real 3.5 creds is the verification, as
  `viya4-connectivity.test.ts`'s own first run on 2026-08-19 was for Viya 4.
  Verified `npm run test:live` reports it as a clean skip on this unconfigured
  machine (`11 pending`, exit 0). **A live 3.5 deployment was deploying as this
  slice landed; running the scaffold against it — the "first run is the
  verification" step — is deferred to the end of Phase 5 (Sean's call,
  2026-09-03), along with any other 3.5 testing.**

- **Audit outcome.** The four live suites (`viya4-connectivity`, `viya4-job`,
  `submission-corpus`, `proc-python-rich-output` — the Plan text says "three",
  predating `proc-python-rich-output`) cover the 2c / 2b-3a / 3c-i wire paths
  well. **One real gap: cancel — Findings 75/76.** `cancelJob`'s `If-Match`
  round trip is live wire behaviour (a bare `PUT` draws `428` on `verde`), it
  regressed silently once, and until now only a by-hand check on 2026-09-01
  guarded it. **Closed here** with a new mutating suite
  `test/live/viya4-job-cancel.test.ts`: submit a 30-second `data _null_` sleep
  (SAS-only — the `If-Match` requirement is the cancel endpoint's, independent
  of what the job runs, so no Python interpreter is needed and the suite keeps
  `viya4-job.test.ts`'s "no `PROC PYTHON`" posture), wait until it is running,
  `cancelJob`, assert `ok` (which on this deployment is end-to-end proof the
  fresh-`ETag` `If-Match` path still satisfies the `428`). The terminal-state
  check is best-effort `console.warn` only — Finding 76 measured the job's
  `state` reading `running` for 24+ seconds after an accepted cancel, so
  asserting a prompt `canceled` would be flaky by that finding's own
  measurement. **Not a gap:** 3c-ii `parseTraceback` and 4c
  `tracebackDiagnostics.ts` are pure text transforms over log lines the
  streaming suites already prove arrive intact — unit-covered against recorded
  fixtures, no additional wire risk; 4d's diagnostics surface is VS Code
  integration with no new Viya calls (integration tier + manual pass);
  `probeRuntime()` (3e) has no live test but a deployment's Python availability
  is a site property, not a code one. Recorded in full in the new
  `docs/dev/live-testing.md` §"What the live tier covers, and what it does not".

- **Docs — new `docs/dev/live-testing.md`** ("The live test tier in anger",
  the page `docs/dev/README.md` already had planned for 5b). Covers the three
  gates with the env-var names in full, the `NODE_EXTRA_CA_CERTS` /
  `--use-system-ca` case, a per-suite table of what each costs the deployment,
  the cleanup contract for mutating tests (per-run unique value; `after`-hook
  delete that clears its handle first and `console.warn`s a failed cleanup),
  the `viya35` scaffold's unverified status, and the audit summary above.
  `docs/dev/testing.md`'s "Tier three — live" section trimmed to a short
  overview (the three gates in brief, the two carried rules) plus a pointer;
  registered in `.vitepress/config.mjs`'s Contributing sidebar and linked from
  `docs/dev/README.md`.

**Checks (2026-09-03, this VS Code session):** `npm run typecheck` (all three
projects), `npm run lint`, `npx prettier --write` on the new/changed files,
`npm run check:docs` (all four steps, `docs:build` included — the new page and
the trimmed section both build clean), `npm run check:copyright` (184 OK),
`npm run check:secrets` (OK), `npm run test:unit` (**1197 passing**, unchanged
from 5a — no `src/` touched), `npm run test:live` (11 pending / clean skip,
exit 0). `test:integration` not warranted — no `src/` or integration-tier
change, same call as 5a. **Review:** the adversarial pass was waived by Sean
(2026-09-03) — test-files-plus-docs only, no `src/`. The two AI reviewers on
[PR #99](https://github.com/Shai-Alit/sas-py-vscode/pull/99) then raised one
Major and two nits. **Major (fixed):** `viya4-job-cancel.test.ts` submitted a
fully deterministic job under the fixed `SESSION_NAME`, so it did not meet
`CONTRIBUTING.md`'s per-run-uniqueness rule for a mutating suite — the
submitted step now starts with a `%put` of a `randomUUID`-derived marker
(`viya4-job.test.ts`'s own pattern), so a leaked session or job is traceable
to its run by `grep`; the marker is emitted, not read back. **Nits (one
addressed, one deferred):** the flat `120_000` timeout does not cover
`waitWhilePending`'s worst case the way `viya4-job.test.ts`'s computed ceiling
does — the comment now owns that tradeoff (this suite has no long log-stream
poll, and the two sibling live suites make the same choice); and
`describeFailure` is now a fourth byte-identical copy across the live suites —
left for its own small cleanup that lifts it into `test/helpers/live-gate.ts`
rather than expanding this slice into three untouched files.

**Live-verified 2026-09-03** against `verde` (Viya 4), token loaded via the
`viya-api-probe` skill's creds mechanism, scoped run `npm run test:live --
--grep "job cancel"`: **1 passing, 8.0 s, exit 0**, no `console.warn` lines —
the job was observed running before the cancel, `cancelJob` returned `ok` (the
fresh-`ETag` `If-Match` `PUT` accepted, not the `428` a bare cancel draws — the
Finding 75 guard holds live), the job settled to a terminal `canceled` state,
and the `after` hook deleted the session. Node needed `NODE_OPTIONS=--use-system-ca`
to reach the compute service — `NODE_EXTRA_CA_CERTS=/c/certs/cacert.pem` was
*not* sufficient (the first attempt failed `compute-unreachable` on the first
`/compute/contexts` call), matching `submission-corpus.test.ts`'s own P33 note.
**Incidental observation, not asserted:** the SAS `data _null_; rc = sleep(30,
1); run;` step cancelled *promptly* (~8 s, not its full 30 s), unlike Finding
76's `PROC PYTHON` loop which ran to its natural end — consistent with Finding
76's reasoning that a SAS `data` step has statement boundaries SAS controls
where a single Python call inside one `submit`/`endsubmit` block does not. The
suite makes no timing claim either way.

The `viya35` scaffold's live run is deferred to the end of Phase 5 per the note
above; **nothing else is open before this merges.**

**Retired 2026-09-03, same day, by [ADR-0022](../adr/0022-drop-viya-35-support.md)
— not deferred further, dropped.** The 3.5 deployment noted above as
"deploying as this slice landed" did not turn into something this project
could reach, and very few Viya 3.5 customers remain in the target audience.
Rather than keep carrying the deferred item forward, architectural Viya 3.5
support is dropped outright: `test/live/viya35-connectivity.test.ts` and
`test/fixtures/viya35/` are removed, `DialectId` is `"viya4"` alone, and there
is no more deferred 3.5 testing to pick up at any future phase boundary. See
ADR-0022 for the full record and PRODUCTION_PLAN.md §1.4/§6 for the updated
plan text.

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
