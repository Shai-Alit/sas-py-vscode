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

☐ **9a — Format decision.**

- ☐ **Run the spike first, before anything else in this phase**: in a clean
  VS Code profile with `ms-toolsai.jupyter` **not** installed, confirm
  whether a `.ipynb` file opens as a notebook at all, and whether a
  registered `NotebookController` for `jupyter-notebook` appears in its
  kernel picker. This decides the rest of the phase's shape.
- ☐ Register only a `NotebookController` (no serializer) against the
  existing `jupyter-notebook` notebook type, per
  [ADR-0024](../adr/0024-notebooks-are-ipynb-native.md); add the
  `notebookKernel<X>`-style keyword VS Code's own guide recommends for
  discoverability.
- ☐ If the spike shows `.ipynb` files don't open as notebooks (or the
  controller doesn't appear in the kernel picker) without `ms-toolsai.jupyter`
  installed: document it as a recommended or required companion extension
  (`docs/`, marketplace listing, `extensionDependencies`/`extensionPack` if
  warranted) and record the finding as an amendment to ADR-0024 — **not** a
  reason to build a bespoke format instead.

☐ **9b — Controller + execution.**

- ☐ Decide and implement the backend-sharing refactor: lift `backends`/
  `backendFor` (or an equivalent) out of `createRunCommandHandlers`'s
  private closure so a `NotebookController` and the Run File commands share
  one cached backend per profile, rather than each holding an independent
  one.
- ☐ Decide whether the run-target (ADR-0011/0020) status-bar concept extends
  to notebooks, or whether the kernel picker alone is the notebook's
  equivalent choice (Plan, above) — not an implicit default either way.
- ☐ Wire `NotebookController.executeHandler` to `ExecutionBackend.execute()`
  with `freshNamespace: false` (already documented for exactly this case,
  `backend.ts:80-93`), and the interrupt handler to the existing
  `cancelJob`/`cancelRun` path — same Finding 75/76 caveat applies (a
  cancelled cell's statement still runs to completion).
- ☐ `test/helpers/recorded-<notebook-or-controller>.ts`, reusing
  `recorded-proc-python.ts`'s fixtures where the wire shape is identical
  (it is — the backend seam doesn't know it's being called from a notebook).

☐ **9c — Renderers + diagnostics.**

- ☐ Build the small, per-mime-type notebook renderer script(s)
  (`contributes.notebookRenderer`), in upstream's `LogRenderer.ts`/
  `HTMLRenderer.ts` shape — dependency-free, no shared code with
  `ResultPanel`'s webview — reusing `resultPanelModel.ts`'s `RichOutput` →
  render-data reduction *logic* where it overlaps, not its transport.
- ☐ Spike whether `RunDiagnostics`/`tracebackDiagnostics.ts` can target a
  notebook cell's `vscode-notebook-cell:` URI directly (Plan, above) before
  deciding whether notebooks need their own diagnostics story or inherit the
  existing one nearly unmodified.

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
would be the first probe recorded here, continuing this project's global
finding numbering from Finding 92 (`phase-8.md`).
