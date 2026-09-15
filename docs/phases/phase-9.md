# Phase 9 — Notebooks

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 9 — Notebooks

**Scoped 2026-09-04**, from the same separate clone (`sas-py-vscode-cowork`)
Phases 6, 7 and 8 were scoped from, kept apart from whatever the primary
working copy has in flight for the same reason as those three passes.
Technical grounding came from a codebase survey of both this repo
(`src/backend/backend.ts`, `src/backend/richOutput.ts`, `src/run/commands.ts`,
`src/run/resultPanel.ts`/`resultPanelModel.ts`, `docs/adr/0011`, `0019`,
`0020`, `0021`) and `vscode-sas-extension` (its one and only notebook
implementation, `client/src/components/notebook/`), plus VS Code's own
Notebook API documentation (`code.visualstudio.com/api/extension-guides/notebook`
and `.../docs/datascience/jupyter-notebooks`, both fetched this session — see
citations inline below). **No live-Viya probe was run or needed this
session** — see the Probe findings section for why. No code was written.

**What this phase is not: a wire-behaviour question.** Every other phase
scoped from this clone (6, 7, 8) turned on "what does the deployment actually
do," settled by a live probe. Phase 9 is different in kind: the Viya-side
mechanics a notebook needs — a persistent Python namespace across cells
(§1.2/§1.5.6 of `PRODUCTION_PLAN.md`, backed by `proc python restart;`,
probe finding 38), streaming per-run output, rich-output capture via the
working-directory diff (ADR-0019), and cancellation (Findings 75/76) — were
**all settled in Phases 2–5, for the Run File flow, and none of it is
Run-File-specific.** `ExecuteOptions.freshNamespace` (`backend.ts:80-93`) is
already documented in-repo as *"Run File passes `true`; a notebook cell
passes `false`"* — Phase 3's own design already had Phase 9 in mind. What
this phase actually is: a VS Code Notebook API integration question (which
notebook type, whose serializer, whose renderer) and a code-sharing question
(can a notebook controller reach the same cached backend/session Run File
already holds, without a slice that changes any Viya-facing behaviour).

**The central decision, carried from `PRODUCTION_PLAN.md` §6 open decision
7: ipynb-compatible or bespoke — now settled, not merely scoped.**
[ADR-0024](../adr/0024-notebooks-are-ipynb-native.md), written the same day
as this scoping session once the technical case below was clear: **Phase 9
notebooks are ipynb-native, with no bespoke fallback.** This project will
not build a second, proprietary notebook format for Python the way the SAS
extension built `.sasnb` for SAS — a developer already using Jupyter
notebooks gets the same file format everywhere, not a shape only this
extension understands. What the rest of this section (and 9a's own spike)
still resolves is *how* — implementation mechanics, not whether. The SAS
extension chose bespoke (`.sasnb`): its own `NotebookSerializer` (`Serializer.ts`)
reads/writes a flat, non-Jupyter JSON array (`{language, value, kind,
outputs}[]`, no notebook-level metadata), registered under its own
`notebookType: "sas-notebook"` with a `*.sasnb` file selector
(`package.json`'s `contributes.notebooks`), and its own two notebook
renderers (`LogRenderer.ts`/`HTMLRenderer.ts`, registered via
`contributes.notebookRenderer`, one tiny webview-renderer script per mime
type: `application/vnd.sas.compute.log.lines` and `application/vnd.sas.ods.html5`).
That choice makes sense for SAS: a `.sasnb` opened in Jupyter or GitHub would
be meaningless JSON, so there is nothing to lose by inventing a format.
**Python is the opposite case.** A `.ipynb` this extension produces —
Python cells, Python outputs (`text/plain`, `text/html`, `image/png`,
structured tracebacks) — is *already* a well-formed Jupyter notebook by
nbformat's own model, which represents a cell's output as exactly the
mime-bundle shape this project's `RichOutput` union already is
(`backend.ts:196-204`). A user's `.ipynb` produced against Viya would render
correctly on GitHub, in JupyterLab, or in any other ipynb-aware tool with no
knowledge of this extension at all — something `.sasnb` structurally cannot
do. `PRODUCTION_PLAN.md` §3.1 already names this as one of three places this
project intends to *exceed* upstream rather than match it ("ipynb rather
than a bespoke format"); this session's survey confirms the technical case
for that recommendation is real, not just aspirational.

**How to get there without owning a serializer.** VS Code's own extension
guide documents this pattern directly, for exactly this situation: *"A
controller is directly associated with a notebook serializer and a type of
notebook... If you're publishing a `NotebookController`-providing extension
separately from its serializer, then add an entry like `notebookKernel` to
the keywords in its `package.json`"* (cites its own worked example: an
alternative kernel for the pre-existing `github-issues` notebook type). This
is precisely the shape of the well-established prior art for exactly this
problem — the .NET Interactive and Deno Jupyter kernels do not reimplement
`.ipynb` serialization; they register their own `NotebookController` against
VS Code's own notebook infrastructure for `.ipynb` files and show up as a
selectable kernel in the picker, "extensibility beyond what the Jupyter
extension provides... such as the .NET Interactive Notebooks and Gather" per
the Jupyter extension's own marketplace listing. **If the same pattern holds
here, 9a does not write a serializer at all** — it contributes only a
`NotebookController` (execution) targeting the existing `.ipynb`
infrastructure, and gets real, portable `.ipynb` files for free.

**What this session could not settle, and 9a must resolve first — a
mechanics question, not a reopening of ADR-0024's format decision.** Two live
components are both plausibly involved in
"what currently owns `.ipynb` serialization and the `jupyter-notebook`
notebook type": VS Code's own core notebook machinery, and/or the
`ms-toolsai.jupyter` marketplace extension. Every source found this session
(the extension guide's own `github-issues`-alternative-kernel example; the
Jupyter extension's own listing text, *"The Jupyter Extension uses the
built-in notebook support from VS Code"*) is consistent with `.ipynb`
opening as a notebook independent of any kernel/execution extension being
installed, with `ms-toolsai.jupyter` layering the kernel-management UX,
keymaps, and renderers on top of infrastructure that already exists — but
none of it is a direct statement of "you can register a Python-on-Viya
kernel for a `.ipynb` file with **zero** other extensions installed, and it
will just work." This is a hands-on spike, not a documentation question —
open a `.ipynb` file in a clean VS Code profile with only this extension
installed (no `ms-toolsai.jupyter`), and see whether it opens as a notebook
at all, and if so whether a registered `NotebookController` for
`jupyter-notebook` shows up in the kernel picker. **9a's very first task,
before any other design decision in this phase, is that spike** — the
answer decides whether "install `ms-toolsai.jupyter`" becomes a real
(optional or required) dependency this project has never had before, which
is exactly the kind of thing `PRODUCTION_PLAN.md`'s "no local Python
required... any local dependency proves unavoidable, it must be... justified
in writing" bar was written for (that bar is about local Python
specifically, not a VS Code extension dependency, but the spirit — don't
accrue a dependency by default — applies here too, and is worth a written
decision either way).

**What ports closely, once the format question is settled:**

- **The single-shared-session design.** Upstream's `NotebookController`
  (`Controller.ts:10-127`) calls the same module-level `getSession()`
  singleton the ordinary Run/Run Selection commands use — one connection,
  shared state, "notebook cells and regular runs share state" by
  construction, not by extra wiring. That is exactly this project's own
  design already (`ComputeSessionManager` is a per-profile singleton); the
  *shape* of "the controller reuses the existing session machinery, it
  doesn't stand up its own" transfers directly even though none of the
  session code itself does (Phase 2's `Session` abstract base was already
  rejected wholesale — ADR-0015 — long before this phase).

  > **Amended 2026-09-14, during 9b, before it was pushed.** This bullet's
  > own "shared state" language was read literally during 9b's first cut —
  > one `ProcPythonBackend` per profile, shared by Run File and the
  > notebook controller — and the manual pass (§9.9) found that destructive:
  > `PROC PYTHON` has one interpreter namespace per session, and this
  > project's own Run File resets it on every whole-file run
  > (`freshNamespace: true`, decided in Phase 3, which upstream's SAS-side
  > execution has no equivalent of needing at all). Upstream's own literal
  > session sharing works *for SAS code* precisely because SAS has nothing
  > like a `PROC PYTHON` namespace reset to collide with; porting the shape
  > without noticing that difference produced two individually-correct
  > designs that destroy each other's state when actually shared. Fixed by
  > [ADR-0035](../adr/0035-notebook-gets-its-own-compute-session.md): the
  > notebook controller gets its own compute session instead. "Reuses the
  > existing session *machinery*" still holds — the notebook's session is
  > built from the exact same `ComputeSessionManager` class, `ProcPythonBackend`
  > and `BackendCache` Run File's own uses, nothing bespoke — but "the same
  > *session instance*" does not, and should not have been assumed from this
  > bullet's own wording. See ADR-0035 and this file's own 9b Runbook entry
  > for the full account.
- **Sequential-cells-through-one-execute() semantics.** Upstream's
  `_execute(cells)` runs cells one at a time through `_doExecution`, matching
  this project's own backend, where `busy` already refuses a second
  concurrent `execute()` rather than queuing it (`backend.ts:380-388`).
  A `NotebookController`'s own execution model is already inherently
  sequential-per-cell (VS Code awards one `NotebookCellExecution` at a time
  per controller by convention), so this is a confirming parallel, not new
  risk.
- **Interrupt → cancel.** Upstream's `_interruptHandler` maps to
  `session.cancel?.()`; this project's `NotebookController` would map its own
  interrupt handler to the same `cancelJob`/`cancelRun` path Phase 4b/4c
  already built and live-verified, **with the same Finding 75/76 caveat
  still true**: a cancelled cell's in-flight Python statement runs to its
  natural end regardless, and the messaging built for Run File's "Cancelled."
  case is the thing to reuse or extend, not reinvent.

**What needs real design work, not a port:**

- **Reaching the same cached backend Run File already holds.** `commands.ts`
  currently keeps its `backends: Map<string, CachedBackend>` cache and its
  single-in-flight-run tracking (`currentRun`/`currentReset`) as **private
  closures inside `createRunCommandHandlers`** — nothing outside that
  function can reach the same backend instance for a given profile today.
  A notebook controller built naively alongside it would either duplicate
  that caching (two independent backend instances for one profile, defeating
  the whole "notebook and editor share state" goal `PRODUCTION_PLAN.md`
  promises) or require lifting `backends`/`backendFor` out of the closure
  into something both a `NotebookController` and `createRunCommandHandlers`
  can import — a real, scoped refactor, not a detail, and it should happen
  as its own step before the controller is written, the same way Phase 6/7/8
  each flagged their own shared-module promotion question (`links.ts`) rather
  than deciding it implicitly by whichever caller lands first.
- **Output transport is a different pipe, not a smaller version of the same
  one.** `ResultPanel` (`resultPanel.ts`) is a singleton `WebviewPanel` with
  its own CSP/nonce, a message-backlog-and-replay protocol built specifically
  around `retainContextWhenHidden: false` discarding the webview on
  hide/show, and one shared output surface per *window*, not per cell.
  `NotebookCellOutput`/`NotebookCellOutputItem`/`NotebookRendererScript` is
  VS Code's own, structurally separate pipeline — output lives inside each
  cell's own document, rendered by small per-mime-type renderer scripts
  registered via `contributes.notebookRenderer`, no `WebviewPanel`, no CSP,
  no backlog concept at all. **`resultPanelModel.ts`'s reduction logic**
  (`toRenderItem`, total over the `RichOutput` union, already producing
  localized strings and pre-built `data:image/png;base64,...` URIs) is
  reusable *conceptually* — the same "turn one `RichOutput` into
  DOM-renderable data" step has to happen for a notebook cell too — but the
  transport underneath it does not carry over, and 9c needs its own small
  renderer script(s), in the shape of upstream's `LogRenderer.ts`/
  `HTMLRenderer.ts` (tiny, dependency-free, one per mime family) rather than
  a scaled-down `ResultPanel`.
- **Diagnostics may port further than they look, and this is worth checking
  early rather than assuming either way.** Phase 4d's `RunDiagnostics`
  (`src/run/diagnostics.ts`) publishes one `vscode.Diagnostic` per failing
  run, keyed on the *editor document's* URI. VS Code gives every notebook
  cell its own real `TextDocument` with a `vscode-notebook-cell:` URI — which
  `languages.createDiagnosticCollection` can target exactly the same way it
  targets an ordinary file today. If that holds, `tracebackDiagnostics.ts`'s
  offset-mapping and `primaryFrame`/`primaryPosition` logic could plausibly
  publish a real, clickable Problems-panel entry against a notebook cell with
  little more than a URI substitution — a notable simplification worth
  confirming with a small spike in 9c rather than assumed, and worth
  confirming *before* deciding whether a notebook needs its own parallel
  error-surfacing story at all.
- **Run-target gating may not apply to notebooks the way it applies to
  files, and this is a real open question, not an oversight.** ADR-0011/0020
  ("Local" vs. a named Viya profile) governs whether this extension
  contributes *anything* to a `.py` file's editor surface — the ambiguity it
  exists to resolve is "the run button already belongs to `ms-python.python`
  on a local file; who does a habitual click actually mean." A notebook's
  kernel picker is already an explicit, per-notebook choice — picking "Python
  on Viya" as the kernel *is* the run-target decision, made once per
  notebook, with no button-ownership ambiguity to arbitrate. Whether the
  status-bar run-target concept needs to extend to notebooks at all, or
  whether the kernel picker alone is sufficient and a separate "Local"
  affordance for notebooks is simply out of scope (this project doesn't run
  Python locally at all, so a notebook's "other" kernel choices are always
  someone else's kernel, e.g. `ms-toolsai.jupyter`'s own local one), is not
  decided here — flagged for 9b.

**What does not port — deliberate non-goals, already settled elsewhere:**

- Upstream's `exporters/toSAS.ts`/`toHTML.ts` (`.sasnb` → `.sas`/`.html`) has
  no equivalent need here: per ADR-0024, a `.ipynb` this extension produces
  is already directly openable, diffable, and exportable by every other
  ipynb-aware tool. 9d (export) should be scoped small or dropped — not
  assumed necessary the way upstream needed it for its own bespoke format.
- Multi-language cells (upstream's `supportedLanguages = ["sas","sql",
  "python","r"]`) — this project is Python-only by design (§1, non-negotiable
  constraint); a notebook here needs exactly one supported cell language.

**Testing.** Same shape this project has committed to for every prior
port-and-adapt phase: mock at the HTTP/backend boundary, never copy the
logic under test into the test file. The specific new surface is VS Code's
own notebook execution/serialization API, which `@vscode/test-electron`
(the existing integration tier) already exercises for other extensions'
`NotebookController`s — no new test *infrastructure* is obviously needed
beyond notebook-shaped fixtures (`.ipynb` files with known cell/output
content) alongside the existing `test/fixtures/` tree, but the actual test
strategy for "does a `NotebookController`'s execution loop correctly drive
the shared backend" is 9b's own design work once the backend-sharing
question above is settled — a controller built directly against
`ExecutionBackend` can reuse the same recorded-transport fixtures
(`recorded-proc-python.ts`) Phase 3/4 already built, the same way Phase 6/7/8
each proposed a `recorded-<feature>.ts` variant for their own new surface.

**Dialect risk.** None identified. Nothing in this phase talks to a
Viya-version-sensitive endpoint; it is entirely client-side VS Code
integration atop backend mechanics Phases 2–5 already dialect-proofed.

*Slices, refined from `PRODUCTION_PLAN.md`'s original one-line sketch
("9a format decision + serializer; 9b controller + execution; 9c renderers;
9d export"):*

- **9a — Dependency spike + controller registration.** *Small*, smaller than
  the original sketch assumed now that the format question is settled
  (ADR-0024): no serializer to write, only a `NotebookController` to
  register against existing `.ipynb` infrastructure. What this slice still
  sizes is the spike's outcome on *dependency handling* — if `.ipynb`
  support turns out to need `ms-toolsai.jupyter` installed, 9a's scope grows
  to include documenting that as a recommended or required companion
  extension (`docs/`, marketplace listing, `extensionDependencies`/
  `extensionPack` if warranted) rather than avoiding the dependency by
  building a bespoke format instead.
- **9b — Controller + execution.** *Medium* — the backend-sharing refactor
  (lifting `backends`/`backendFor` out of `commands.ts`'s closure) plus the
  run-target-for-notebooks decision both land here, ahead of the controller
  itself.
- **9c — Renderers + diagnostics.** *Medium* — new small notebook-renderer
  scripts (one or a few, by mime family, in upstream's shape not
  `ResultPanel`'s), plus the diagnostics-porting spike above.
- **9d — Export.** *Small*, and possibly droppable outright (see "what does
  not port," above).

*Exit:* a user can create or open a Python notebook, select "Python on Viya"
as its kernel, run cells against the same session and persistent Python
namespace Run File already uses, see stdout/HTML/figures/tracebacks rendered
per cell, and have that notebook be a real, portable `.ipynb` file usable
outside this extension entirely — which is the one capability this phase
can offer that upstream's own bespoke `.sasnb` structurally cannot.

---

Everything above is the product. Everything below is breadth, and each phase
is independently valuable and independently shippable. Order is a
recommendation, not a dependency chain — reprioritise based on what users
actually ask for once v0.1.0 is in their hands.

---

## Runbook

_Scoped 2026-09-04, before any code was written — technical grounding (what
ports vs. what needs design work vs. what's a non-goal) came from the
codebase survey and web research described in the Plan section above.
**Recommended order: 9a → 9b → 9c → 9d**, since 9a's spike outcome
(ipynb-native vs. bespoke fallback) changes what 9b–9d are actually
building. Nothing here is a hard technical barrier — this is a
recommendation, not a dependency lock._

☑ **9a — Format decision.** Code-complete 2026-09-14.

- ☑ **Run the spike first, before anything else in this phase**: in a clean
  VS Code profile with `ms-toolsai.jupyter` **not** installed, confirm
  whether a `.ipynb` file opens as a notebook at all, and whether a
  registered `NotebookController` for `jupyter-notebook` appears in its
  kernel picker. This decides the rest of the phase's shape. **Done, by two
  independent checks, not one:** (1) reading the installed VS Code
  (1.109.5)'s own bundled `ipynb` extension
  (`resources/app/extensions/ipynb/package.json`) — publisher `vscode`, not
  `ms-toolsai` — shows it, not `ms-toolsai.jupyter`, owns
  `contributes.notebooks: [{type: "jupyter-notebook", selector: [{
  filenamePattern: "*.ipynb"}]}]`, so `.ipynb` opening as a notebook does not
  depend on the Jupyter extension being present at all; (2) a throwaway
  `NotebookController` contributing no serializer of its own was launched via
  `code --extensionDevelopmentPath=<spike ext> --user-data-dir=<empty>
  --extensions-dir=<empty>` (nothing installed, not even this extension's
  own real code) against a test `.ipynb`, and it was auto-selected as the
  notebook's only candidate kernel and executed a cell end to end — proof
  by successful execution, not just by inspecting a manifest. **Verdict:
  `ms-toolsai.jupyter` is not a dependency of this feature; ADR-0024 needs no
  amendment.**
- ☑ Register only a `NotebookController` (no serializer) against the
  existing `jupyter-notebook` notebook type, per
  [ADR-0024](../adr/0024-notebooks-are-ipynb-native.md); add the
  `notebookKernel<X>`-style keyword VS Code's own guide recommends for
  discoverability. **Done** — `src/notebook/notebookController.ts`
  (`registerNotebookController`, wired from `src/extension.ts`); the
  `notebookKernelPython` keyword was added to `package.json`. Real execution
  against a Viya session is explicitly out of scope here — 9b's own slice,
  gated on the `backends`/`backendFor` refactor (Plan, above) — so the
  controller's `executeHandler` is a deliberate, honest placeholder: every
  cell run reports "Running notebook cells on SAS Viya isn't implemented
  yet." as a real cell error output, rather than either doing nothing or
  surfacing VS Code's own generic no-handler error. Formalised as a
  permanent regression test, not just a one-off spike:
  `test/integration/notebook/controller.test.ts` opens an untitled
  `jupyter-notebook`, runs its one cell, and asserts the placeholder error
  appears — and since the integration host already launches with
  `--disable-extensions` (`runTest.ts`), this test is itself continuous,
  every-CI-run proof that no Jupyter extension is required, not a claim that
  could go stale unnoticed.
- ☑ If the spike shows `.ipynb` files don't open as notebooks (or the
  controller doesn't appear in the kernel picker) without `ms-toolsai.jupyter`
  installed: document it as a recommended or required companion extension
  (`docs/`, marketplace listing, `extensionDependencies`/`extensionPack` if
  warranted) and record the finding as an amendment to ADR-0024 — **not** a
  reason to build a bespoke format instead. **N/A — the guarded condition
  didn't occur.** The spike showed the opposite: `.ipynb` opens and a
  registered controller is selectable with zero other extensions installed.
  No companion-extension documentation and no ADR-0024 amendment are needed.

  `npm run typecheck`/`lint`/`format:check`/`check:copyright`/`check:secrets`/
  `check:coverage-scope`/`check:contracts`/`docs:reference:check` all green.
  `npm run coverage` green (1675 unit; coverage 95.92/95.46/95.75/95.92,
  unaffected — `src/notebook/notebookController.ts` imports `vscode` and is
  excluded from unit-tier scope in `.c8rc.json`, the same rule every other
  pure-registrar module in this repo already follows —
  `docs/adr/0009-coverage-scope.md`). `npm run test:integration` green — 406
  passing, including `notebook controller (9a) ✔ is auto-selected and
  executes a cell with no Jupyter extension installed`.
  **Environment note, unrelated to this slice's code but worth recording:**
  this run first failed twice for reasons that had nothing to do with the
  source change — a stale `.vscode-test/` cache whose `Code.exe` had been
  replaced by a copy of `node.exe` (cleared, so `@vscode/test-electron`
  re-downloaded a genuine VS Code 1.137.0), and then `ELECTRON_RUN_AS_NODE=1`
  being set in the shell, which makes any Electron binary launched directly
  (bypassing the `code` CLI wrapper, which strips that variable) start as
  headless Node instead of the real app — surfacing as "bad option:
  --disable-extensions" from V8's own flag parser, not from VS Code. Unset it
  before invoking `node out/test/integration/runTest.js` directly and the
  run behaves normally.

  **Adversarial self-review: run before any push, no blocking findings.**
  Two non-blocking observations, both verified independently rather than
  taken on faith: `controller.test.ts` opens a notebook editor via
  `showNotebookDocument` and never closes it — checked against every other
  file under `test/integration/` for an assumption that no notebook editors
  are open, found none, so left as is (matches existing convention: no
  integration test in this repo closes editors it opens); the polling
  loop's caught error is retry-diagnostics inside a test, not a swallowed
  error in production code, and the reviewer flagged it only to be explicit
  about why it doesn't count against the "no swallowing catch blocks"
  priority. Nothing folded into the branch as a result.

  **Manual test items run 2026-09-14 (Sean): all five pass.**
  `docs/dev/manual-tests/phase-9.md` 9.1–9.5 — the kernel picker entry
  coexisting with `ms-toolsai.jupyter` rather than conflicting with it
  (something the automated suite cannot check, since it always runs with
  `--disable-extensions`), the placeholder error rendering for real in the
  notebook UI, multi-cell behaviour, no-Viya-connection-needed, and theme
  legibility.

☑ **9b — Controller + execution.** Code-complete 2026-09-14.

- ☑ Decide and implement the backend-sharing refactor: lift `backends`/
  `backendFor` (or an equivalent) out of `createRunCommandHandlers`'s
  private closure so a `NotebookController` and the Run File commands can
  each reach a cached backend per profile, rather than duplicating that
  caching logic. **Done** — `src/run/backendCache.ts` (`createBackendCache`,
  `BackendCache`, `CachedBackend`), a straight move of `commands.ts`'s own
  pre-9b `backends`/`guardFor`/`backendFor`/dispose-loop, unchanged in
  behaviour. An unexpected bonus this move surfaced: `backendCache.ts`
  imports `vscode` only for types (`LogOutputChannel`, `Disposable`), so
  unlike `commands.ts` itself it is not `vscode`-runtime-dependent —
  `check-coverage-scope.mjs` and `test/unit/coverage-scope.test.ts` both
  caught that it therefore belongs in the unit tier, not `.c8rc.json`'s
  exclude list, so a first attempt to exclude it was reverted in favour of
  real unit coverage (`test/unit/run-backend-cache.test.ts`, exercising the
  reuse/reconnect/orphan-close/dispose paths directly against `test/helpers/
  recorded-connection.ts`'s simulated wire — 99.39% lines on the module).
  **Corrected same day, before this slice was ever pushed — see the "9.9 and
  ADR-0035" entry below.** The very first cut had `extension.ts` build
  *one* `BackendCache` and hand it to both `registerRunCommands` and
  `registerNotebookController`, on the theory that "one connected backend
  per profile" was the whole of what sharing meant. The 2026-09-14 manual
  pass (§9.9) found that literal sharing destructive — `PROC PYTHON` has one
  interpreter namespace per session, so Run File's own `freshNamespace: true`
  wiped the notebook's state on every whole-file run. `extension.ts` now
  builds **two** `BackendCache`s, from two independent `ComputeSessionManager`s
  (ADR-0035) — `createBackendCache` itself did not need to change at all,
  since it was already just a cache keyed on `connection.profileId` with no
  assumption that only one caller would ever build one.
- ☑ Decide whether the run-target (ADR-0011/0020) status-bar concept extends
  to notebooks, or whether the kernel picker alone is the notebook's
  equivalent choice (Plan, above) — not an implicit default either way.
  **Decided: the kernel picker alone.** Selecting "Python on Viya" as a
  notebook's kernel is already an explicit, per-notebook choice with no
  button-ownership ambiguity to arbitrate, so `notebookController.ts` never
  reads `RunTargetStore` and a cell run never checks `targets.readiness()`
  the way `runNow`/`resetPythonState` do — it only needs an active profile,
  which `BackendCache.backendFor()`'s own `sessions.connect()` call already
  reports the absence of, the same way it does for Run File. Full reasoning
  in `notebookController.ts`'s own doc comment.
- ☑ Wire `NotebookController.executeHandler` to `ExecutionBackend.execute()`
  with `freshNamespace: false` (already documented for exactly this case,
  `backend.ts:80-93`), and the interrupt handler to the existing
  `cancelJob`/`cancelRun` path — same Finding 75/76 caveat applies (a
  cancelled cell's statement still runs to completion). **Done** —
  `src/notebook/notebookController.ts`'s `createNotebookExecutionHandlers`,
  the same seam-vs-registration split `commands.ts` draws between
  `createRunCommandHandlers`/`registerRunCommands`. `controller
  .interruptHandler`, not per-cell cancellation tokens: the VS Code API's
  own doc comment recommends an interrupt handler for exactly this
  "REPL-style controller interrupts whatever is running" shape, matching
  upstream's own `_interruptHandler → session.cancel?.()`. **A scope
  decision beyond the punch list's own three bullets, made and recorded
  here rather than left implicit:** cell output renders `text/plain`
  inline, live, via `NotebookCellOutputItem.stdout` as it streams; `text/
  html`/`image/png` get one honest placeholder line each (the same shape
  `outputChannel.ts` already uses for the same two mime arms) rather than
  guessing whether VS Code core's own built-in renderers for those types
  work with no `ms-toolsai.jupyter` installed — that question is 9c's own
  spike, not assumed here; and `application/vnd.python.traceback` produces
  no separate output at all, since its content already streamed as
  `text/plain` ahead of it (`src/run/render.ts`'s own doc comment), with a
  raised cell instead getting VS Code's own red-X indicator from
  `execution.end(false, …)`. Full mime-by-mime reasoning in
  `notebookController.ts`'s own doc comment.
- ☑ `test/helpers/recorded-<notebook-or-controller>.ts`, reusing
  `recorded-proc-python.ts`'s fixtures where the wire shape is identical
  (it is — the backend seam doesn't know it's being called from a notebook).
  **No new helper file needed** — `test/helpers/recorded-connection.ts`
  (already built for `commands-backend.test.ts` in Phase 4a) is reused as-is,
  by both `test/unit/run-backend-cache.test.ts` and
  `test/integration/notebook/execution.test.ts`. The latter drives
  `createNotebookExecutionHandlers` against a **fake** `vscode
  .NotebookController`/`NotebookCellExecution` (not a real, registered one):
  a real `NotebookController.createNotebookCellExecution` throws "notebook
  controller is NOT associated to notebook" unless VS Code's own
  kernel-picker state already selected it — state this suite has no reason
  to fight, since `NotebookController`/`NotebookCell`/`NotebookCellExecution`
  are plain structural interfaces in `@types/vscode`, not classes, so a fake
  satisfying only the members actually called is the same "fake the vscode
  surface that isn't the thing under test" shape `commands.test.ts`'s own
  `fakeOutputChannel()` already uses. Found the hard way: a first attempt
  used a real throwaway controller and every case failed with "notebook
  controller is NOT associated to notebook", an unhandled rejection VS Code
  raised before any job was ever created; fixed by fully faking the
  controller/execution rather than fighting kernel selection.
  `controller.test.ts`'s own 9a regression still proves the real,
  activation-registered controller reaches a terminal execution state with
  no Jupyter extension installed — lightened from asserting the now-gone
  placeholder message to asserting a terminal `executionSummary` is
  reached, since 9b replaced the placeholder it used to pin.
- ☑ **Added same day, from the manual pass (§9.8/§9.9), before this slice was
  ever pushed — not a separate slice, the punch list's own scope grew.**
  - **§9.9 (real failure): the notebook and Run File shared one
    `ProcPythonBackend`/interpreter per profile, and Run File's own
    `freshNamespace: true` silently wiped the notebook's variables on every
    whole-file run — worse, running the notebook again afterward showed the
    wipe too, since it really was the same session. Root cause: `PROC
    PYTHON` has exactly one interpreter namespace per compute session
    (finding 38); there is no way for a "resets every run" surface and a
    "persists forever" surface to share one safely.** Fixed by
    [ADR-0035](../adr/0035-notebook-gets-its-own-compute-session.md): the
    notebook controller now gets its own `ComputeSessionManager`, its own
    `purpose`-namespaced `SessionBindingStore` (`binding.ts`'s
    `sessionBindingKey` gained an optional `purpose` parameter, `undefined`
    for Run File's own binding so every install's existing binding keeps
    reattaching unchanged), and its own `BackendCache` — `extension.ts`
    builds two of each instead of one shared instance. `Disconnect` (and
    Sign Out) now end both sessions (`compute/commands.ts`'s
    `registerComputeCommands` takes an optional second session manager to
    also disconnect, quietly); `Connect` and the status bar stay scoped to
    Run File's session only, unchanged, since the notebook's kernel picker
    is already its own equivalent affordance. See ADR-0035 for the full
    accounting, including the alternatives rejected (a warning before an
    implicit reset; making Run File stop resetting by default) and the real
    cost (two live sessions per profile when both surfaces are warm at
    once, each still independently reaped after 15 idle minutes).
  - **§9.8 (partial): a cell run right after an interrupted one can sit with
    no output for as long as the interrupted statement takes to actually
    finish server-side (Finding 76 — an interrupt's local abort clears
    `backend.busy` well before the SAS-side statement it interrupted really
    ends), and nothing on screen said why.** Given a real "why" requires
    tracking an abandoned, already-cancelled statement — exactly what Phase
    4c already declined to build for Run File's own identical gap, as
    disproportionate — this adds only an honest, cause-agnostic notice
    (`notebookController.ts`'s `executeCell`, `WAITING_NOTICE_DELAY_MS` =
    3s): "still no output — this cell may simply be running long, or a
    previous statement on this session may still be finishing" once a cell
    has produced nothing for that long. Deliberately does not claim to know
    the cause — an ordinary long-running cell with no output (this phase's
    own `time.sleep(30)` test case included) looks identical from the
    client's side, and a message that guessed wrong would be worse than
    silence. Real tracking, for a precise message, is carried forward as a
    candidate in `phase-11.md`'s "Also carried here" list, not decided
    against permanently.

  `npm run typecheck`/`lint`/`format:check`/`check:copyright`/`check:secrets`/
  `check:coverage-scope`/`check:contracts`/`build` all green — re-run after
  the ADR-0035 split, not just after the original cut. `npm run coverage`
  green — 1685 unit tests (up from 1675 at 9b's original cut, +4 for
  ADR-0035's `binding.ts`/`bindingStore.ts` `purpose` cases), coverage
  95.94/95.48/95.81/95.94 lines/branches/functions/statements (unchanged
  from the original cut — `binding.ts`/`bindingStore.ts` stayed at 100%
  throughout, `.c8rc.json`'s 95.8/95.8/95.6/95.4 floor cleared with room, no
  ratchet raise needed this slice). `npm run test:integration` green — 411
  passing (up from 406 at 9a; 409 after the original 9b cut, +2 for the
  waiting-notice cases): `execution.test.ts`'s five cases total (streamed
  success, busy refusal, the two waiting-notice cases, interrupt-then-
  recover) plus `controller.test.ts`'s updated 9a/9b regression. No test
  needed changing for the `BackendCache` split itself —
  `execution.test.ts`'s own suite already built its own local `BackendCache`
  per test rather than asserting anything about sharing with Run File.

  **Manual test items updated in the same slice, not left for a later
  housekeeping catch-up — and restructured, not just reworded, after a
  first draft buried the basic "does a cell actually run" tests under the
  9a section header while the new 9b section jumped straight to interrupt
  (caught on review before this was even handed off — see this file's own
  9b commit history for the correction).** The 9a section
  (`docs/dev/manual-tests/phase-9.md`) now holds only §9.1, the
  registration/kernel-picker question 9b didn't change; its old §9.2–§9.5,
  which tested 9a's own placeholder `executeHandler`, are gone (that
  placeholder no longer exists). The new "Real execution (phase 9b)"
  section leads with the fundamentals — §9.2 run + streamed output, §9.3
  namespace persistence across cells, §9.4 a raised traceback, §9.5 no
  active profile, §9.6 theme legibility — **before** the
  interrupt/busy/session-sharing/placeholder items (§9.7–§9.10), with an
  explicit note that those later items are moot if §9.2 doesn't pass.

  **Run 2026-09-14 (Sean): §9.1–§9.7, §9.10 pass; §9.8 partial and §9.9
  failed — see this Runbook entry's own "Added same day" bullet above for
  the root causes and fixes.** §9.8's expectation is reworded to describe
  the honest waiting notice rather than silence; §9.9's is reworded to
  describe the real guarantee ADR-0035 gives — a notebook's own state
  persists across its own cells and across a reload, and Run File no longer
  touches it, rather than the literal cross-surface `print(shared)` claim
  the first cut could not actually deliver. Both reset to unchecked,
  **needing a fresh live re-run** against the code above before this slice
  is considered verified — left for Sean.

  **Fresh live re-run, 2026-09-14 (Sean): §9.8, §9.9, and §9.11 (added by
  the adversarial pass below) all pass against the corrected code** —
  `docs/dev/manual-tests/phase-9.md` updated in place, all Phase 9 items now
  checked.

  **Adversarial self-review: run 2026-09-14, three findings, all folded in
  before push.** Per `CLAUDE.md`, this ran against the full diff — the
  ADR-0035 two-session split included, not only the original single-cache
  9b cut. Nothing has been pushed or opened as a PR before this pass
  completed. Each finding was verified independently before acting on it:

  - **Wrong-target interrupt (real, not theoretical).**
    `interruptHandler` cancelled whatever `currentRun` held, regardless of
    which `vscode.NotebookDocument` VS Code actually called it for.
    `execution.start()` and the `backend.busy` check are separated by two
    `await`s, so a second notebook's own queued cell can already show VS
    Code's "running"/Interrupt chrome while it is really about to be
    busy-refused — hitting Interrupt there would have cancelled the
    *other* notebook's genuinely-running cell instead. Fixed:
    `currentRun` now records the `notebook` it belongs to, and
    `interruptHandler` acts only when its own argument matches.
  - **Fire-and-forget `appendOutput` with no explanation.** The
    waiting-notice `setTimeout` callback's `execution.appendOutput(...)`
    was `void`-fired with nothing said about why, unlike every other
    fire-and-forget promise in this codebase (`backendCache.ts`'s
    `dispose()`, `resultPanel.ts`'s `revealFrame`), which name why
    swallowing is safe. Fixed: same swallow, now with the same comment
    convention — a vanished cell or notebook is the only way this
    rejects, and there is nothing further to do about it.
  - **"Disconnect ends both sessions" (ADR-0035) had no test, automated or
    manual.** Not reachable at the unit or integration tier:
    `registerComputeCommands` only runs against real
    `vscode.commands`/`EventEmitter` APIs, and the existing integration
    suite (`test/integration/compute/commands.test.ts`) deliberately never
    opens a live session. Recorded instead as `docs/dev/manual-tests/
    phase-9.md` §9.11, unchecked, alongside §9.8/§9.9's own pending live
    re-run.

  `npm run verify` (format/lint/typecheck/copyright/secrets/
  coverage-scope/contracts/build/coverage) green after folding all three
  fixes in — 1685 unit tests, coverage unchanged at
  95.94/95.48/95.81/95.94. One `@typescript-eslint/prefer-optional-chain`
  lint error surfaced and was fixed during this pass:
  `currentRun === undefined || currentRun.notebook !== notebook` rewritten
  as `currentRun?.notebook !== notebook`. `npm run test:integration` green
  — 411 passing, including `cancels the in-flight cell via
  interruptHandler`, the case the interrupt fix touches most directly.

  **PR #176's own AI review (2026-09-14) raised two findings on this slice,
  both fixed and folded into the branch before push.** Recorded here, not
  under "Probe findings" below — these are review findings about this
  slice's own code and docs, not measured Viya wire behaviour, so they carry
  no `9.x` finding number.

  - **No regression test for the wrong-target-interrupt fix.** The fix
    above (`currentRun?.notebook !== notebook`) has no test that actually
    drives the two-notebook race it addresses — the suite's only interrupt
    case exercises a single notebook. Fixed:
    `test/integration/notebook/execution.test.ts` gained `"does not cancel
    a different notebook's in-flight cell"` — starts a run on notebook A,
    calls `interruptHandler` against a second notebook B that never ran
    anything, and asserts A's own job runs to completion uninterrupted.
  - **Stale test-count numbers.** By the time this PR was opened, `main` had
    been merged into the branch (`5f2c7d5`), bringing in tests from Phase 8
    work landed after 9b's own original cut — but this file and
    `STATUS.md` still carried the pre-merge counts (1685 unit / 411
    integration) while the PR description already carried the post-merge
    ones (1693 unit / 418 integration), a mismatch the review caught.
    Reconciled: a fresh `npm run verify` on the branch, with the new
    regression test above folded in, produced **1693 unit tests**, coverage
    **95.95/95.48/95.83/95.95**, and **419 integration** passing — the
    numbers now recorded here and in `STATUS.md`.

  `npm run verify` and `npm run test:integration` green after folding both
  fixes in (numbers above).

☑ **9c — Renderers + diagnostics.** Code-complete 2026-09-14.

- ☑ Build the small, per-mime-type notebook renderer script(s)
  (`contributes.notebookRenderer`), in upstream's `LogRenderer.ts`/
  `HTMLRenderer.ts` shape — dependency-free, no shared code with
  `ResultPanel`'s webview — reusing `resultPanelModel.ts`'s `RichOutput` →
  render-data reduction *logic* where it overlaps, not its transport.
  **Done, but not the way the punch list assumed — no renderer script was
  needed at all, once the open question 9b's own doc comment left standing
  was actually spiked rather than guessed at.** The installed VS Code's own
  bundled `notebook-renderers` extension (publisher `vscode`, not
  `ms-toolsai` — `resources/app/extensions/notebook-renderers/package.json`,
  read directly, the same two-pronged rigor 9a's own spike used for `ipynb`)
  registers a `notebookRenderer` for `image/gif`/`image/png`/`image/jpeg`/
  `image/svg+xml`/`text/html`/`application/javascript` and several
  `vscode.builtin`-prefixed mimes, with `requiresMessaging: "never"` — a
  purely client-side renderer that needs zero cooperation from any
  extension, installed or not. Upstream's own `LogRenderer.ts`/
  `HTMLRenderer.ts` exist because `application/vnd.sas.compute.log.lines`/
  `application/vnd.sas.ods.html5` are non-standard mimes VS Code has never
  heard of; this project's own `RichOutput` union already uses the
  *standard* `text/html`/`image/png` VS Code's own built-in renderer already
  owns, so there was nothing left to build a renderer for. The proof this
  finding is real and not a doc-reading guess: `controller.test.ts`'s 9a
  regression is *continuous* evidence for it, the same way it already was
  for `ipynb` — the integration host launches with `--disable-extensions`
  (`runTest.ts`), which disables installed extensions, not the ones VS Code
  itself bundles, so every CI run already proves the built-in renderer is
  present with no `ms-toolsai.jupyter` needed. What that proof cannot
  reach — whether the rendered pixels actually look right in a real
  window — is `docs/dev/manual-tests/phase-9.md`'s new §9.12 (`text/html`)
  and rewritten §9.10 (`image/png`, reset to unchecked since the behaviour
  it tests genuinely changed), left for Sean. Implemented as
  `src/notebook/notebookRender.ts` (pure, `vscode`-free — the same "decide
  *what*, not *how*" split `render.ts`/`resultPanelModel.ts` already draw,
  now a third instance of it) plus `notebookController.ts`'s own
  `appendRichOutput`, which turns a `NotebookOutputPiece` into a real
  `vscode.NotebookCellOutputItem` (`.text(markup, "text/html")` for HTML;
  the plain `new NotebookCellOutputItem(bytes, "image/png")` constructor,
  `Buffer.from(base64, "base64")`-decoded, for the image — `.data()` has no
  static factory the way `.text()`/`.stdout()`/`.error()` do). The two old
  placeholder `vscode.l10n.t()` strings are gone.
- ☑ Spike whether `RunDiagnostics`/`tracebackDiagnostics.ts` can target a
  notebook cell's `vscode-notebook-cell:` URI directly (Plan, above) before
  deciding whether notebooks need their own diagnostics story or inherit the
  existing one nearly unmodified. **Confirmed by a real test, not just by
  reading the code: `tracebackDiagnostics.ts`'s `mapFrameToOrigin`/
  `primaryPosition` never inspect `ProgramOrigin.uri`'s scheme, so a cell's
  `vscode-notebook-cell:` URI maps a `<string>` frame exactly like an
  ordinary file's.** `RunDiagnostics` itself needed zero changes.
  `notebookController.ts`'s `executeCell` now calls `diagnostics.clearFor`
  at the same point `commands.ts`'s `runNow` does (right after `execute()`
  succeeds), captures the trailing `application/vnd.python.traceback`
  output the same way `drainOutputs` does, and calls `diagnostics.publish`
  on a failed outcome with a captured traceback. **Decided: this module
  gets its own `RunDiagnostics` instance (a second `DiagnosticCollection`),
  not Run File's** — not because sharing one is unsafe (diagnostics are
  keyed per-URI; a cell's URI and a file's URI never collide), but because
  ADR-0035's own precedent already settled that a notebook gets its own
  instance of shared infrastructure rather than a wired-through reference to
  Run File's, and because Run File's own extra clearing hooks
  (`onDidSignOut`, `onDidCloseTextDocument`, the run-target flipping to
  Local — Phase 5d-iv) have no notebook equivalent to hook into (no
  run-target concept at all, 9b's own "kernel picker alone" decision).
  **A scope decision made and recorded here, not left implicit: a stale
  Problems entry for a notebook cell that outlives a sign-out or a closed
  notebook is a known, accepted gap**, the same "disproportionate" call
  Phase 4c made for Run File's own comparably narrow waiting-cell-message
  gap — threading `onDidSignOut`/close events through `extension.ts` a
  second time for a surface a person will, in the ordinary case, just
  re-run was judged not worth it this slice. Carried to `phase-11.md` as a
  candidate, not decided against permanently. New manual item §9.13
  (`docs/dev/manual-tests/phase-9.md`) covers the raised-cell Problems entry
  and its independence from Run File's own entries, left for Sean.

  `npm run typecheck`/`lint`/`format:check`/`check:copyright`/`check:secrets`/
  `check:coverage-scope`/`check:contracts`/`build` all green. `npm run
  coverage` green — **1725 unit tests** (up from 1693 at 9b), coverage
  **95.97/95.48/95.84/95.97** lines/branches/functions/statements
  (`.c8rc.json`'s 95.8/95.8/95.6/95.4 floor cleared with room, no ratchet
  raise needed) — `src/notebook/notebookRender.ts` at 100% (new,
  `test/unit/notebook-render.test.ts`, mirroring `run-render.test.ts`'s own
  shape one mime arm at a time). `npm run test:integration` green — **430
  passing** (up from 419 at 9b): `test/integration/notebook/execution
  .test.ts` gained a "rich output rendering (9c)" suite (`appendRichOutput`
  driven directly with a synthetic `RichOutput` — the recorded-connection
  wire's `getFiles`/`getDirectoryMembers` never produces a real `text/html`/
  `image/png` output for a real run to stream, per 3c-i's own fixture doc
  comment, so this is the one piece of this module's own logic that suite
  cannot reach end to end) and a "Problems-panel diagnostics (9c)" suite
  (one test: publish on a raised cell, clear on the next run — the same
  `TRACEBACK_LINES` shape `commands-diagnostics.test.ts` already uses,
  through the real simulated wire this time, since the traceback capture
  path only exists once a real `ProcPythonBackend` streams one).

  **Manual test items updated in the same slice**: §9.10 (`docs/dev/
  manual-tests/phase-9.md`) reworded from the placeholder-text expectation
  to real inline rendering and reset to unchecked — the behaviour it tests
  genuinely changed, the same rule §9.8/§9.9 followed at 9b. New "Rich
  output rendering and diagnostics (phase 9c)" section added: §9.12
  (`text/html`, a pandas DataFrame repr) and §9.13 (a raised cell's
  Problems-panel entry, and its independence from Run File's own entries).
  **Left for Sean, not yet run.**

  **Adversarial self-review ran 2026-09-14 against the full diff, before any
  of it was pushed — ten findings, one blocking, all verified independently
  and folded into the branch.**

  - **Finding 1 (blocking, security).** `text/html` output reached VS Code's
    own built-in notebook renderer as real, unsanitized markup — that
    renderer executes an embedded `<script>` tag (`renderHTML()`'s
    `element.innerHTML` assignment followed by `domEval()`), gated only by
    workspace trust, which ADR-0002 already keeps open for any code this
    extension runs at all. This directly contradicted
    [ADR-0021](../adr/0021-result-panel-webview.md)'s own load-bearing
    decision that a `<script>` inside `text/html` output must stay inert —
    and the notebook case is worse than the panel's, since a notebook's
    outputs serialize into the `.ipynb` on save and re-execute on reopen
    with no Viya round trip, including for someone who opens a file a
    colleague sent them. **Sean's call, asked before any fix was written:
    sanitize the markup before it reaches VS Code's renderer**, rather than
    building this extension's own CSP-locked notebook renderer or accepting
    the risk via an ADR amendment. `src/notebook/htmlSanitize.ts` (new, pure,
    no `vscode` import) is an allow-list tokenizer/re-serializer, not a
    deny-list edit — its own doc comment has the full design (raw-text
    handling for `<script>`/`<style>`/etc., a CSS deny-substring check for
    `style`, an inline-`data:`-image-only `<img src>`). No new dependency:
    ADR-0005 already flags "the first runtime dependency" as the day its own
    currently-vacuous production audit gate stops being vacuous, and this
    surface (library `_repr_html_` output, not arbitrary documents) did not
    need one to solve.
    [ADR-0036](../adr/0036-notebook-html-output-is-sanitized.md) records the
    decision, cross-referenced from ADR-0021 so the two surfaces' answers to
    the same threat don't read as contradicting each other by accident.
    `test/unit/notebook-html-sanitize.test.ts` (24 cases, 100%
    lines/functions) covers script stripping (including one hidden inside a
    dropped raw-text element's own content, so it can never resurface as a
    tag boundary), event-handler attributes, CSS exfil vectors in `style`,
    non-`data:` `<img src>`, comments, entities, and the sanitizer's own
    parser-edge cases (unterminated tags/comments/raw-text, mismatched close
    tags, HTML5's "a trailing `/` doesn't self-close a non-void element"
    rule). New manual item §9.13 verifies the one thing no automated test
    can: that the real built-in renderer, given this sanitizer's actual
    output, truly executes nothing.
  - **Finding 2.** A closed notebook's Problems-panel entries outlived it,
    and the gap was a misattribution risk, not just staleness: a
    `vscode-notebook-cell:` URI is `CellUri.generate(notebook, handle)`, and
    a fresh model's handle pool restarts at `0` on reopen, so a stale entry
    could resurface against whichever cell next holds that same handle.
    Fixed, not carried to `phase-11.md` — the deferral reasoning
    (`onDidSignOut` needing `extension.ts` wiring a second time) did not
    apply to the close case, since `registerNotebookController` already has
    `context` to subscribe with. `NotebookExecutionHandlers` gained
    `handleNotebookClosed`, the same "plain function of a document, not the
    real subscription" shape `executeHandler`/`interruptHandler` already
    use, wired to a real `vscode.workspace.onDidCloseNotebookDocument` in
    `registerNotebookController` and callable directly in
    `execution.test.ts` with no real editor tab to open and close. Sign-out
    remains the accepted, narrower gap the doc comment already named.
    New manual step under §9.13: close and reopen the notebook, confirm the
    entry is gone rather than reattached to the wrong cell.
  - **Finding 3.** Run File's and the notebook's own `RunDiagnostics`
    default-constructed under the same collection name, which VS Code logs
    as "already exists" and silently renames the second on every
    activation. `RunDiagnosticsDeps` gained an optional `name`
    (`diagnostics.ts`); the notebook's own default now passes
    `"pythonOnViyaNotebook"` — Run File's own default string, the one
    `phase-4.md` pins verbatim, is unchanged.
  - **Finding 4.** Six existing 9b integration tests leaked a real
    `DiagnosticCollection` each (never disposed), each re-triggering
    Finding 3's warning. Fixed: all six now push `handlers.diagnostics` onto
    the suite's own `disposables`, the same pattern the one test that
    already injected diagnostics used.
  - **Finding 5.** The existing diagnostics test asserted only length,
    message and source — never the position the slice's own doc comment
    claimed was "confirmed, not assumed." Fixed: the cell is now two source
    lines, so asserting `range.start.line === 1` actually distinguishes a
    correct mapping from a bug that always reports line 0. Also added: a
    "no frame maps" case (a library-only stack publishes nothing, the same
    `tracebackDiagnostics.ts` rule `commands.ts`'s own tests already cover)
    and the close/reopen case Finding 2 needed anyway.
  - **Finding 6.** §9.12's original repro (a bare `DataFrame` as a cell's
    last expression) cannot produce a `text/html` output at all —
    `richOutput.ts` only captures a file written to the working directory
    (ADR-0019), and there is no implicit `_repr_html_` capture
    (`docs/running-python.md`). Reworded to
    `DataFrame(...).to_html("table.html")`, the same shape
    `phase-3.md`'s own manual test and §9.10's `plt.savefig(...)`-only cell
    already use.
  - **Finding 7.** `diagnostics.ts`'s own "What gets published, and when"
    section named only `commands.ts` as a caller; `notebookController.ts` is
    a second one now, with different clearing rules. One sentence added.
  - **Finding 9.** Image output carried no alt text, unlike the result
    panel's own `labels.imageAlt`. `appendRichOutput` gained an `imageIndex`
    parameter (`executeCell` counts image outputs as they stream and passes
    the running total) and sets `NotebookCellOutput.metadata.vscode_altText`
    — the field VS Code's own built-in renderer's `getAltText` actually
    reads — to `vscode.l10n.t("Output image {0}", …)`, the exact string
    `resultPanel.ts` already uses.
  - **Finding 8.** `l10n/bundle.l10n.json` looked stale in the reviewing
    session's own working copy. Turned out not to be a branch issue at
    all: the file is generated and gitignored (`.gitignore`'s own comment,
    "generated, not authored"), never a committed artifact — running
    `npm run l10n:extract` locally reproduces it from source on demand, and
    doing so this session (picking up this slice's own new
    `vscode.l10n.t()` call alongside everything else) produced a byte-
    identical file to what was already on disk. Nothing to fix in the PR.
  - **Finding 10.** Noted, not fixed here, per the finding's own framing —
    a rejected `appendOutput` mid-stream (a notebook closed mid-run) skips
    `execution.end`, pre-existing since 9b. Carried to `phase-11.md`.

  Every fix folded into the branch before push, per this project's own
  adversarial-review rule. `npm run verify` (format, lint, typecheck,
  copyright, secrets, coverage-scope, contracts, build, coverage) green —
  **1749 unit tests** (up from 1725), coverage **96.03/95.51/95.9/96.03**
  (statements/branches/functions/lines; `.c8rc.json`'s 95.8/95.4/95.6/95.8
  floor cleared, no ratchet raise needed) —
  `src/notebook/htmlSanitize.ts` at 100% lines/100% functions (two
  single-line `/* c8 ignore next */` markers on `noUncheckedIndexedAccess`
  fallbacks a non-optional regex capture group can never actually take, the
  same category `tracebackDiagnostics.ts`'s own `primaryFrame` doc comment
  already names and designs around). `npm run docs:build`/`docs:links:self`/
  `docs:samples` green (the new ADR and manual-test cross-links resolve).
  `npm run test:integration` **ran green 2026-09-14** — **433 passing**, up
  from 419 at 9b's post-merge reconciliation (430 right after this slice's
  own two new suites, +3 more from the adversarial review's own net-new
  cases below — the arithmetic checks out). The prior session's "could not
  be run" note was a misdiagnosis, not a genuine environment limitation:
  `Code.exe: bad option: --disable-extensions` is the same
  `ELECTRON_RUN_AS_NODE` leak already documented in `phase-5.md`'s 5d-iii
  Runbook entry — a shell spawned inside the VS Code extension host inherits
  `ELECTRON_RUN_AS_NODE=1` plus other `VSCODE_*` vars, so
  `@vscode/test-electron` launches the downloaded `Code.exe` as bare Node
  instead of Electron, on any machine that shell runs on, sandboxed or not.
  Stripping those vars for the one command (the same workaround 5d-iii
  recorded) launched the real Electron host and all 433 cases passed,
  including the three net-new adversarial-review cases (sanitizer
  end-to-end, "no frame maps," "closed notebook clears every cell") and the
  two enhanced ones (position-asserting diagnostics, alt-text-asserting
  image render) the previous paragraph called typecheck-clean but
  unverified — now verified for real.

  **Manual test pass ran 2026-09-14 (Sean) — §9.10, §9.12, §9.13, and §9.14
  all pass.** `docs/dev/manual-tests/phase-9.md` updated in place (all four
  boxes ticked). §9.10 — reworded by this slice to test real `image/png`
  rendering rather than the placeholder it used to check, and reset to
  unchecked for that reason — renders as a real inline image, not a
  placeholder, closing the one manual item this slice's own reword had left
  unverified since 9b's own live pass predates the reword. §9.12 confirms
  `text/html` renders as real, sanitized markup; §9.13 confirms a raised
  cell gets a Problems-panel entry at the right position, cleared on the
  next run and on notebook close; §9.14 confirms an embedded `<script>`
  never executes. This slice is now fully verified — code, the adversarial
  review, `npm run verify`, `npm run test:integration`, and the manual
  pass — with nothing outstanding before it ships.

  **[PR #177](https://github.com/Shai-Alit/sas-py-vscode/pull/177)'s own AI
  review then raised three findings against `htmlSanitize.ts` — two
  blocking, one non-blocking — all real, all fixed and folded in before
  push, per this project's own review-findings policy.** Each was verified
  independently first, by actually reproducing the bypass against the
  compiled sanitizer before touching the code — the same discipline the
  9b PR review findings got:

  - **Blocking — `</style/>` and other malformed-but-spec-valid close tags
    walked past the raw-text element boundary entirely.** `findRawTextEnd`
    matched only a bare `</style>` (`\s*>` immediately after the name); a
    real HTML5 tokenizer ends a raw-text element on `</style` followed by
    *any* tag-name-terminating character (whitespace, `/`, or `>`).
    `<style>a{}</style/><script>alert(1)</script></style>` therefore
    skipped past the first `</style/>` looking for a bare match, found the
    *second*, later `</style>` instead, and re-emitted everything in
    between — the live `<script>` included — as "already-scanned, safe CSS
    text" verbatim. Reproduced against the compiled sanitizer before
    fixing. Fixed: `findRawTextEnd` now matches only the start of a
    recognized end-tag name (a lookahead on the terminating character,
    consuming nothing) and reuses `findTagEnd`'s own quote-aware scan to
    find the real closing `>` from there — mirroring the spec instead of
    guessing at one more literal pattern. Two new cases in
    `notebook-html-sanitize.test.ts` cover the `/`- and
    attribute-terminated forms; a third covers the fallback when even that
    inner scan finds no real `>` before the end of input.
  - **Blocking — a backslash-escaped `url(`/`javascript:` slipped past
    `CSS_DANGER`'s literal substring check.** CSS lets any character be
    escaped, including as a hex code point (`\75\72\6c(` decodes to `url(`
    once a real parser resolves it); `CSS_DANGER`'s regex only recognizes
    the literal, unescaped spelling. Reproduced: a `style` attribute value
    built exactly this way passed `isDangerousCss` unchanged and was
    re-emitted as a live `style="…"` attribute. Rather than reimplement
    CSS escape decoding to check *after* it, `isDangerousCss` now also
    rejects any value containing a literal backslash at all — legitimate
    `Styler.to_html()` output has no reason to contain one, so this closes
    the whole class of escape-based obfuscation rather than only the one
    encoding the review happened to try. Same fix covers both the `style=`
    attribute and a `<style>` block's own content, since both go through
    `isDangerousCss`.
  - **Non-blocking — flagged as the same underlying gap as the blocking
    finding above, just a different encoding of it** (a backslash-escaped
    `url(` reaching outside the page without necessarily executing
    script). Closed by the same backslash-rejection fix; no separate
    change needed.

  `npm run verify` green after folding all three in — **1752 unit tests**
  (up from 1749), coverage **96.04/95.51/95.9/96.04**
  (`.c8rc.json`'s floor cleared with room; `htmlSanitize.ts` itself at
  100%/96.55%/100%/100% lines/branches/functions/statements, the one
  remaining uncovered branch the same pre-existing
  `noUncheckedIndexedAccess` artifact noted above). `npm run
  test:integration` green, unchanged at 433 passing (these were unit-tier
  fixes only — no integration case exercises `htmlSanitize.ts` directly).
  `npm run check:docs`/`check:secrets` green.

  **A follow-up review on the same push (commit `8020b29`) found a fourth
  bypass the backslash fix didn't close, same day.** `isDangerousCss` checks
  the raw attribute-value text a `style="…"` attribute was written with —
  but a real HTML parser entity-decodes an attribute's value on the way into
  the DOM, a separate decoding step from the CSS-escape one the backslash
  fix already covers. `style="background:&#x75;&#x72;&#x6c;&#40;https://
  evil.example/x&#41;"` contains no literal `url(`, `@import`, etc. and no
  backslash, so it passed `isDangerousCss` unchanged — reproduced against
  the compiled sanitizer before fixing, confirming the raw (still-encoded)
  attribute value is what this function sees, not what a browser would
  build. Fixed the same way as the backslash case rather than reimplementing
  entity decoding to check after it: any `&` at all in a style value or
  block is now treated as dangerous too. (A `<style>` block's own raw-text
  content is not actually entity-decoded by a real HTML parser — only
  attribute values are — so this half of the rejection is defense-in-depth
  rather than closing a reachable bypass there, and cheaper than proving the
  distinction holds than getting it wrong would be.) New test:
  "drops a style attribute that hides url( behind an HTML character
  reference". `npm run verify` green — **1753 unit tests**, coverage
  unchanged at 96.04/95.51/95.9/96.04; `npm run test:integration` unchanged
  at 433 passing; `npm run check:docs`/`check:secrets` green. Replied to and
  resolved all four review threads on PR #177 with the reproduction and fix
  for each.

☐ **9d — Export.**

- ☐ Scope this slice only after 9b/9c land — likely small or droppable,
  since the notebook is already a portable `.ipynb` per ADR-0024 (Plan,
  above).

---

## Probe findings

**No live-Viya probe was run this session, deliberately, not by oversight.**
Every other Phase 6/7/8 scoping session in this clone ran probes because
each phase's central open question was "what does this deployment actually
do" — a wire-behaviour fact only a probe can settle. Phase 9's open
questions are different in kind: whether a persistent Python namespace
across cells is possible (settled already, Phases 1.5/2, `proc python
restart;`, finding 38), whether rich output can be captured per execution
(settled already, ADR-0019, Findings 61–67), and whether cancellation and
streaming output work (settled already, Phase 4, Findings 75/76) are all
Viya-side questions this project answered in earlier phases, for the
general "run some Python and get results back" case that a notebook cell is
just one more caller of. The one genuinely open question this phase raises —
whether `.ipynb` support requires the `ms-toolsai.jupyter` extension to be
installed — is a **VS Code client-side** question, not a Viya one, and no
`viya-api-probe` skill invocation would answer it; it needs the hands-on VS
Code spike named in 9a's own punch-list item instead. If 9a's implementation
turns up a genuine Viya-side question (for example, whether rapid
notebook-cell-at-a-time execution produces working-directory-diff races
ADR-0019's design didn't anticipate at Run File's slower cadence), that
would be the first probe recorded here — numbered `9.1`, per the
phase-scoped finding-numbering scheme adopted 2026-09-09 (`STATUS.md`,
repo-root `CLAUDE.md`), not a continuation of the project's old global
sequence (which this phase file's scoping session originally assumed would
run from Finding 92, `phase-8.md` — since renumbered `8.6` under the new
scheme, per that file's own account of the Phase 7→8 housekeeping
checkpoint).
