// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Phase 9a registered a {@link vscode.NotebookController} against VS Code's
 * own `jupyter-notebook` notebook type (per
 * [ADR-0024](../../docs/adr/0024-notebooks-are-ipynb-native.md) — this
 * extension contributes no serializer of its own) with a deliberate
 * placeholder `executeHandler`. **Phase 9b wires it for real.**
 * `createNotebookExecutionHandlers` is the seam — `executeHandler`/
 * `interruptHandler` as plain functions, no
 * `vscode.notebooks.createNotebookController` call among them — and
 * `registerNotebookController` is the thin shell that builds the real
 * controller and assigns them to it. Same split `commands.ts`'s own doc
 * comment draws between `createRunCommandHandlers` and `registerRunCommands`,
 * for the same reason: a test can drive the execution logic directly, against
 * its own throwaway controller and a recorded backend, without needing the
 * real extension's own `BackendCache` (which has no injectable connection).
 *
 * ## What this slice ports, and what it decides fresh
 *
 * `docs/phases/phase-9.md`'s Plan section named three things this slice had
 * to land: `freshNamespace: false` for `execute()` (already documented for
 * exactly this case, `backend.ts:80-93` — "Run File passes `true`; a notebook
 * cell passes `false`"); the interrupt handler mapping to `cancel()`, the same
 * "REPL-style controller interrupts whatever is running" shape the VS Code
 * API's own `NotebookController.interruptHandler` doc comment recommends over
 * per-cell cancellation tokens; and the backend-sharing refactor
 * (`../run/backendCache`) this module depends on rather than building its own
 * cache.
 *
 * ## This module's own `BackendCache` is not Run File's (ADR-0035)
 *
 * The first cut of this slice, live-tested 2026-09-14, handed this module the
 * *same* `BackendCache` instance as Run File — one `ProcPythonBackend` per
 * profile, shared. That failed the manual pass (`docs/dev/manual-tests/
 * phase-9.md` §9.9): `PROC PYTHON` has exactly one interpreter namespace per
 * compute session (finding 38), so a shared backend meant Run File's own
 * `freshNamespace: true` on every whole-file run (`backend.ts:80-93`,
 * unchanged since Phase 3) silently wiped out whatever the notebook had set —
 * a real, working-as-documented behaviour on *each* side individually, and a
 * data-losing collision between them once 9b made them share one interpreter.
 * There is no cheaper fix than a second session: `proc python restart;`
 * destroys and reinitialises *the* interpreter, not *a* namespace, so a
 * "reset on every run" surface and a "persist forever" surface cannot safely
 * share one.
 *
 * **ADR-0035 gives this module its own `BackendCache`, wrapping its own
 * `ComputeSessionManager`, entirely separate from Run File's.** Both are
 * built in `extension.ts` and both connect the same *active profile* — there
 * is still no per-notebook profile choice (below) — but as two independent
 * SAS compute sessions, each with its own `PROC PYTHON` interpreter, working
 * directory and filerefs. A notebook's own variables now survive a Run File
 * invocation elsewhere on the same profile, and vice versa, because they are
 * no longer the same interpreter. The cost, paid deliberately: a profile used
 * both ways at once holds two live compute sessions rather than one, each
 * still independently reaped after 15 idle minutes (ADR-0012's own reaper,
 * now doubled rather than shared) — see ADR-0035 for the full accounting,
 * including why `Disconnect` ends both (`../compute/commands.ts`'s own doc
 * comment) while the status bar keeps reflecting only Run File's.
 *
 * One question the Plan section left open for this slice: whether the
 * run-target (ADR-0011/ADR-0020) status-bar concept extends to notebooks, or
 * whether the kernel picker alone is the notebook's equivalent choice.
 * **Decided here: the kernel picker alone.** Selecting "Python on Viya" as a
 * notebook's kernel is already an explicit, per-notebook decision with no
 * button-ownership ambiguity to arbitrate — unlike a `.py` file's Run button,
 * which `ms-python.python` might also claim, and which is exactly what
 * ADR-0011's "Local"/profile status-bar toggle exists to resolve. There is
 * nothing for a second, notebook-scoped version of that toggle to add.
 * Concretely: this module never reads `RunTargetStore`, and a cell run never
 * checks `targets.readiness()` the way `runNow`/`resetPythonState` do. It
 * still needs an *active profile* — `BackendCache.backendFor()`'s own
 * `sessions.connect()` call already reports why there is none (or why it is
 * unreachable), exactly the way it does for Run File, with no separate gate
 * this module has to add.
 *
 * ## Output — what renders here (9c)
 *
 * `text/plain` output renders in the cell as it streams, via
 * `NotebookCellOutputItem.stdout` — VS Code's own "this is a running
 * program's console output" mime, chosen over the generic `.text()` for the
 * same reason `outputChannel.ts` appends raw text rather than writing one
 * line at a time: a `print()`-heavy cell should read as one continuous
 * stream, not a wall of separately-bordered output blocks.
 *
 * `text/html` and `image/png` now render for real, as their own standard
 * mime types (`./notebookRender.ts`'s `toNotebookOutputPieces` decides
 * *what*; `appendRichOutput` below decides *how to build the item*).
 * 9b's own doc comment left this an open question — "whether [VS Code
 * core's built-in renderers for these types] work with no `ms-toolsai.jupyter`
 * installed is … a client-side VS Code question 9a's own spike answered for
 * `.ipynb` itself and 9c has not yet answered for these." **9c's own spike
 * answered it, the same two-pronged way 9a did**: the installed VS Code's own
 * bundled `notebook-renderers` extension (publisher `vscode`, not
 * `ms-toolsai` — `resources/app/extensions/notebook-renderers/package.json`)
 * registers a `notebookRenderer` for `image/png`, `text/html` and several
 * other standard mimes, with `requiresMessaging: "never"` — a purely
 * client-side renderer needing no extension-host cooperation from anyone,
 * installed or not. Unlike upstream's own `LogRenderer.ts`/`HTMLRenderer.ts`,
 * this extension needs no renderer script of its own: those exist because
 * `application/vnd.sas.compute.log.lines`/`application/vnd.sas.ods.html5` are
 * *non-standard* mimes VS Code has never heard of, while this project's own
 * `RichOutput` union already uses the standard `text/html`/`image/png` VS
 * Code's own built-in renderer already owns. `controller.test.ts`'s 9a
 * regression is this finding's own continuous proof for the built-in
 * renderer's presence, the same way it already was for `ipynb`: the
 * integration host launches with `--disable-extensions`
 * (`runTest.ts`), which disables installed extensions, not the ones VS Code
 * itself bundles — `notebook-renderers` is bundled the same way `ipynb` is,
 * so every CI run already proves it is there with no `ms-toolsai.jupyter`
 * needed. What that continuous proof cannot reach — whether the rendered
 * pixels actually look right — is a real VS Code window question, left for
 * `docs/dev/manual-tests/phase-9.md`'s new 9c items.
 *
 * `application/vnd.python.traceback` still produces no separate cell output —
 * its content already arrived as ordinary `text/plain` output ahead of it
 * (`../run/render`'s own doc comment: `logFilter.ts`'s `isNoiseLine` passes a
 * real exception's log lines straight through), and a raised cell already
 * gets VS Code's own red-X execution-failure indicator from this module's
 * `execution.end(false, …)` call. What 9c adds instead is a *second, different*
 * use of the same `Traceback` — see the next section.
 *
 * ## Diagnostics — the Problems panel (9c)
 *
 * `RunDiagnostics` (`../run/diagnostics`) ports with no change at all: its
 * position maths (`../backend/tracebackDiagnostics.ts`'s `mapFrameToOrigin`/
 * `primaryPosition`) never inspects `ProgramOrigin.uri`'s scheme, so a cell's
 * own `vscode-notebook-cell:` URI maps a `<string>` frame exactly the way an
 * ordinary file's URI does — confirmed, not assumed, by this slice's own new
 * test case rather than by reading the code and guessing it would work. This
 * module gets its **own** `RunDiagnostics` instance — a second
 * `DiagnosticCollection`, not Run File's — the same shape ADR-0035 already
 * settled for `BackendCache`/`ComputeSessionManager`: not because sharing one
 * is unsafe (diagnostics are keyed per-URI, and a cell's URI and a file's URI
 * never collide), but because nothing about the two surfaces' lifecycles is
 * actually the same, and Run File's own extra clearing hooks (`onDidSignOut`,
 * `onDidCloseTextDocument`, the run-target flipping to Local — Phase 5d-iv)
 * do not apply to a notebook, which has no run-target concept at all (this
 * module's own "kernel picker alone" decision, above) and stays open across a
 * sign-out the same way any other open editor does. **Deliberately not
 * ported**, and flagged here rather than silently assumed: a stale Problems
 * entry for a notebook cell that outlives a sign-out. Phase 4c's own
 * "disproportionate" call on a comparably narrow gap (`../run/commands.ts`'s
 * own doc comment: precise waiting-cell tracking) is the model for treating
 * this as a known, accepted gap rather than a reason to thread
 * `onDidSignOut` through `extension.ts` a second time for a notebook that a
 * person will, in the ordinary case, just re-run. Carried to `phase-11.md`
 * as a candidate, not decided against permanently.
 *
 * **The closed-notebook half of that gap is fixed, not carried** —
 * adversarial review, 2026-09-14 (Finding 2). `registerNotebookController`
 * subscribes to `vscode.workspace.onDidCloseNotebookDocument` itself and
 * clears every one of that notebook's cells — needing no `extension.ts`
 * wiring, unlike sign-out — because the gap here was worse than "stale": a
 * `vscode-notebook-cell:` URI is `CellUri.generate(notebook, handle)`, a pure
 * function of the notebook's own URI and the cell's handle, and a fresh
 * model's handle pool restarts at `0` on reopen, so a closed notebook's old
 * entry could resurface **against whichever cell now holds that same
 * handle**, not just outlive its own.
 *
 * ## Why one module-scoped `currentRun` slot is safe
 *
 * `commands.ts`'s own `currentRun` is a single slot because only one Run File
 * invocation can be in flight in a window at a time; this module's own single
 * slot leans on the same fact from a different angle. `BackendCache
 * .backendFor()` always resolves to *the* active profile's backend, whichever
 * notebook cell called it — there is no per-notebook profile choice in this
 * slice (see above) — so two cell executions racing each other, from the same
 * notebook or two different ones, always contend for the same
 * `ProcPythonBackend` instance. The `backend.busy` check below runs before
 * `currentRun` is ever written, exactly where `commands.ts`'s own `runNow`
 * puts its matching check, and for the same reason a second review pass
 * added there (see that module's own comment on it): the check is what stops
 * a second execution from ever reaching `currentRun`'s assignment or its
 * `finally`, not just what produces a nicer refusal message.
 *
 * One slot does not mean one *notebook*, though — `currentRun` also records
 * which `vscode.NotebookDocument` it belongs to, and `interruptHandler`
 * checks that before touching it. Between `execution.start()` and the busy
 * check above lies an `await`-wide window where a second notebook's own
 * queued cell can already show VS Code's own "running" chrome (and offer
 * Interrupt) while it is really about to be busy-refused; hitting Interrupt
 * there must not cancel whichever *other* notebook's cell is genuinely
 * running underneath `currentRun`.
 */

import * as vscode from "vscode";

import type {
  ExecutionHandle,
  Program,
  RichOutput,
  Traceback,
} from "../backend/backend";
import { localiseBackendProblem } from "../backend/messages";
import type { ProcPythonBackend } from "../backend/procPython";
import type { BackendCache } from "../run/backendCache";
import { RunDiagnostics } from "../run/diagnostics";
import { toNotebookOutputPieces } from "./notebookRender";

/** The id VS Code's kernel picker and `NotebookController.dispose()` key on. */
export const NOTEBOOK_CONTROLLER_ID = "pythonOnViya.viyaNotebookKernel";

/** Owned by VS Code's own bundled `vscode.ipynb` extension, not this one. */
export const NOTEBOOK_TYPE = "jupyter-notebook";

/** How long a cell waits with no output before the honest "still no output"
 * notice appears — see `executeCell`'s own comment on why this is a plain
 * timer and not real tracking of what it might be waiting on. */
const WAITING_NOTICE_DELAY_MS = 3000;

/**
 * Registers the controller against the real {@link NOTEBOOK_CONTROLLER_ID}/
 * {@link NOTEBOOK_TYPE} and pushes it on `context.subscriptions`.
 *
 * `backendCache` is this module's **own** instance, not Run File's — see this
 * module's own doc comment ("This module's own `BackendCache` is not Run
 * File's (ADR-0035)") for why the two were split apart, and
 * `../run/backendCache`'s own doc comment for what a `BackendCache` gives
 * either caller regardless of which one it belongs to.
 */
export function registerNotebookController(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  backendCache: BackendCache,
): vscode.NotebookController {
  const controller = vscode.notebooks.createNotebookController(
    NOTEBOOK_CONTROLLER_ID,
    NOTEBOOK_TYPE,
    vscode.l10n.t("Python on Viya"),
  );
  controller.supportedLanguages = ["python"];
  controller.supportsExecutionOrder = true;
  controller.description = vscode.l10n.t("Run notebook cells on SAS Viya");

  const handlers = createNotebookExecutionHandlers(backendCache, log);
  controller.executeHandler = handlers.executeHandler;
  controller.interruptHandler = handlers.interruptHandler;
  // 9c: this module's own `RunDiagnostics`, not Run File's — see this
  // module's own doc comment ("Diagnostics — the Problems panel") for why.
  context.subscriptions.push(controller, handlers.diagnostics);
  // Adversarial review, 2026-09-14 (Finding 2): a closed notebook's own
  // cells keep whatever Problems-panel entries they had — closing a
  // `vscode-notebook-cell:` URI reused the SAME URI (same handle) after a
  // reopen (`CellUri.generate` is a pure function of the notebook URI and
  // the cell handle, and the handle pool restarts at 0 per model), so a
  // stale entry misattributes to whatever cell now holds that handle rather
  // than merely outliving its own cell. Unlike sign-out (the doc comment's
  // still-accepted gap, below), this needs no second wiring through
  // `extension.ts` — the module already has `context` to subscribe with.
  context.subscriptions.push(
    vscode.workspace.onDidCloseNotebookDocument((notebook) => {
      if (notebook.notebookType === NOTEBOOK_TYPE) {
        handlers.handleNotebookClosed(notebook);
      }
    }),
  );

  log.info(
    vscode.l10n.t(
      "Notebook kernel registered against the {0} notebook type.",
      NOTEBOOK_TYPE,
    ),
  );

  return controller;
}

/**
 * What a real {@link vscode.NotebookController} assigns its own
 * `executeHandler`/`interruptHandler` to — this module's own testable seam,
 * the same role `RunCommandHandlers` plays for `commands.ts`. Typed exactly
 * to the shapes `vscode.NotebookController` itself declares, so assigning
 * either straight onto a real controller (as `registerNotebookController`
 * does) needs no wrapper.
 */
export interface NotebookExecutionHandlers {
  readonly executeHandler: (
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController,
  ) => Promise<void>;
  readonly interruptHandler: (
    notebook: vscode.NotebookDocument,
  ) => Promise<void>;
  /** This module's own `DiagnosticCollection`, not Run File's — see this
   * module's own doc comment ("Diagnostics — the Problems panel") for why.
   * Exposed so `registerNotebookController` can dispose it, the same reason
   * `RunCommandHandlers.diagnostics` is exposed for `commands.ts`. */
  readonly diagnostics: RunDiagnostics;
  /** Clears every one of `notebook`'s own cells from {@link diagnostics} —
   * `registerNotebookController` wires this to the real
   * `vscode.workspace.onDidCloseNotebookDocument`, exposed as a plain
   * function of a `NotebookDocument` (not the subscription itself) for the
   * same reason `executeHandler`/`interruptHandler` are: a test can call it
   * directly against a document `openCell`-style helpers already build, with
   * no real editor tab to open and close. See this module's own doc comment
   * ("Diagnostics — the Problems panel") for why this needed fixing at all. */
  readonly handleNotebookClosed: (notebook: vscode.NotebookDocument) => void;
}

/**
 * Builds the execution logic against `backendCache` — no real
 * `vscode.NotebookController` needed to construct this, only to run cells
 * against (each cell execution is created via whichever `controller`
 * `executeHandler` itself is called with, per the VS Code API's own contract
 * — see {@link NotebookExecutionHandlers}'s doc comment for why that is
 * still enough to test this seam directly).
 *
 * `waitingNoticeDelayMs` defaults to {@link WAITING_NOTICE_DELAY_MS} — the
 * real value — and exists as a parameter only so a test can shrink it rather
 * than wait out three real seconds; see `executeCell`'s own comment on what
 * it triggers and why.
 *
 * `diagnostics` defaults to a fresh {@link RunDiagnostics} — this module's
 * own instance, not Run File's (see this module's own doc comment,
 * "Diagnostics — the Problems panel") — and is injectable for the same
 * reason `commands.ts`'s own `RunCommandDeps.diagnostics` is: a test can hand
 * in one built over a `DiagnosticCollection` it retains and asserts on.
 */
export function createNotebookExecutionHandlers(
  backendCache: BackendCache,
  log: vscode.LogOutputChannel,
  waitingNoticeDelayMs: number = WAITING_NOTICE_DELAY_MS,
  // A distinct collection `name` from Run File's own default (`diagnostics
  // .ts`'s own `COLLECTION_NAME`) — adversarial review, 2026-09-14 (Finding
  // 3): two collections created under the same name make VS Code log an
  // "already exists" warning and silently rename the second one, on every
  // activation, with `extension.ts` now constructing one of each.
  diagnostics: RunDiagnostics = new RunDiagnostics({
    name: "pythonOnViyaNotebook",
  }),
): NotebookExecutionHandlers {
  // See this module's own doc comment ("Why one module-scoped `currentRun`
  // slot is safe") for why a single slot, not one per notebook or per cell,
  // is the right amount of state here.
  let currentRun:
    | {
        readonly notebook: vscode.NotebookDocument;
        readonly backend: ProcPythonBackend;
        readonly handle: ExecutionHandle;
      }
    | undefined;
  // Jupyter's own convention — the `[N]:` a cell shows next to its output —
  // ported as a plain incrementing counter, the same shape
  // `NotebookCellExecution.executionOrder` exists for.
  let executionOrder = 0;

  const executeCell = async (
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController,
  ): Promise<void> => {
    const execution = controller.createNotebookCellExecution(cell);
    executionOrder += 1;
    execution.executionOrder = executionOrder;
    execution.start(Date.now());
    await execution.clearOutput();

    const built = await backendCache.backendFor();
    if (built === undefined) {
      // `sessions.connect()` already reported why — a dead token, an
      // untrusted folder, no profile — the same "nothing further to say
      // here" contract `commands.ts`'s own `runNow` relies on for the
      // identical case.
      execution.end(false, Date.now());
      return;
    }
    const { backend } = built;

    if (backend.busy) {
      await appendError(
        execution,
        localiseBackendProblem({
          code: "busy",
          running: "a run in this window",
        }),
      );
      execution.end(false, Date.now());
      return;
    }

    const program: Program = {
      bytes: new TextEncoder().encode(cell.document.getText()),
      origin: { uri: cell.document.uri, lineOffset: 0 },
    };

    // `freshNamespace: false` — `backend.ts:80-93`'s own documented case: "a
    // notebook cell passes `false`". The interpreter's globals, and every
    // earlier cell's own state, survive.
    const executed = await backend.execute(program, { freshNamespace: false });
    if (!executed.ok) {
      log.warn(executed.reason);
      await appendError(execution, localiseBackendProblem(executed.problem));
      execution.end(false, Date.now());
      return;
    }

    // 9c: reset the Problems-panel entry alongside the other output surfaces,
    // at the point the run actually begins — the same placement, for the
    // same reason, as `commands.ts`'s own `runNow`
    // (`diagnostics.clearFor`'s own doc comment). Keyed on the cell's own
    // document URI, which needs no special-casing here — see this module's
    // own doc comment ("Diagnostics — the Problems panel").
    diagnostics.clearFor(cell.document.uri);
    const handle = executed.value;
    currentRun = { notebook, backend, handle };
    try {
      let sawOutput = false;
      let traceback: Traceback | undefined;
      // Counts only image outputs within this run — `appendRichOutput`'s own
      // doc comment, "Output image {0}" numbered the way a person looking at
      // the cell would, the same `imageIndex` convention
      // `resultPanelModel.ts`'s `labels.imageAlt` uses for the result panel.
      let imageIndex = 0;
      // This phase's manual pass, §9.8: after an interrupted cell,
      // `backend.busy` clears as soon as the *local* abort settles
      // (`procPython.ts`'s own `cancel`/`busy`) — well before the SAS-side
      // statement it interrupted actually finishes, per Finding 76. A cell
      // run right after that can sit with no output for the old statement's
      // remaining duration, and with nothing else on screen that reads as a
      // silent hang rather than a program that is (from the user's side)
      // doing nothing yet. Phase 4c looked at giving Run File a precise
      // message for this same gap and passed on it as disproportionate —
      // building real tracking of an abandoned, already-cancelled statement
      // just to word a status line precisely. This is deliberately the
      // cheaper, honest alternative: a plain elapsed-time trigger, with
      // wording that does not claim to know the cause, because it cannot —
      // the same silence is equally what an ordinary long-running cell with
      // no output looks like (this phase's own `time.sleep(30)` test case
      // included), and a message that guessed "a previous cell" would be
      // wrong exactly there. `phase-11.md`'s "Also carried here" list has the
      // real-tracking option, flagged for a harder look later, not decided
      // against permanently.
      const waitingNotice = setTimeout(() => {
        if (sawOutput) return;
        // Fired, not awaited — this timer's own callback cannot be `async`
        // in a way anything here would await. `appendOutput` can still
        // reject if the cell or notebook has gone away between the timer
        // firing and now (closed mid-run); the same "nothing left to do"
        // swallow `resultPanel.ts`'s own `revealFrame` uses for an editor
        // that vanished out from under it, not a real error to surface.
        void execution
          .appendOutput(
            new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.stdout(
                vscode.l10n.t(
                  "[still no output — this cell may simply be running long, or a previous statement on this session may still be finishing]\n",
                ),
              ),
            ]),
          )
          .then(undefined, () => undefined);
      }, waitingNoticeDelayMs);
      try {
        for await (const output of handle.outputs) {
          sawOutput = true;
          clearTimeout(waitingNotice);
          if (output.mime === "application/vnd.python.traceback") {
            traceback = output.data;
          }
          if (output.mime === "image/png") imageIndex += 1;
          await appendRichOutput(execution, output, imageIndex);
        }
      } finally {
        clearTimeout(waitingNotice);
      }
      const settled = await handle.done;
      if (!settled.ok) {
        log.warn(settled.reason);
        await appendError(execution, localiseBackendProblem(settled.problem));
        execution.end(false, Date.now());
        return;
      }
      // 9c: a run that raised, with a structured traceback to position it
      // by, gets one Problems-panel entry at the innermost user frame — a
      // no-op when no frame maps (a SAS-side error, or an all-library
      // stack). Same call, same reasoning, as `commands.ts`'s own `runNow`.
      if (!settled.value.succeeded && traceback !== undefined) {
        diagnostics.publish(
          program.origin,
          traceback,
          settled.value.diagnostics[0]?.message ?? traceback.message,
        );
      }
      execution.end(settled.value.succeeded, Date.now());
    } finally {
      currentRun = undefined;
    }
  };

  const executeHandler: NotebookExecutionHandlers["executeHandler"] = async (
    cells,
    notebook,
    controller,
  ) => {
    // Cells run one at a time, in order — `NotebookCellExecution`'s own
    // contract (only one execution per cell, and `ProcPythonBackend`'s own
    // serial contract underneath it) makes this the natural shape rather
    // than a design choice this slice had to make.
    for (const cell of cells) {
      await executeCell(cell, notebook, controller);
    }
  };

  const interruptHandler: NotebookExecutionHandlers["interruptHandler"] =
    async (notebook) => {
      // See this module's own doc comment ("Why one module-scoped
      // `currentRun` slot is safe") — this must not cancel a different
      // notebook's genuinely-running cell just because this notebook's own
      // queued cell is showing VS Code's "running" chrome too.
      if (currentRun?.notebook !== notebook) return;
      // Finding 75/76 apply here exactly as they do to Run File's own Cancel
      // (`commands.ts`'s `cancelRun`): a failed server-side cancel is logged,
      // not silently discarded, and even a successful one does not guarantee
      // a step already in flight stops before its own natural end — the
      // cell's own output will show whatever the run's `handle.done`
      // ultimately settles with, same as it would for any other failure.
      const cancelled = await currentRun.backend.cancel(currentRun.handle);
      if (!cancelled.ok) log.warn(cancelled.reason);
    };

  const handleNotebookClosed: NotebookExecutionHandlers["handleNotebookClosed"] =
    (notebook) => {
      for (const cell of notebook.getCells()) {
        diagnostics.clearFor(cell.document.uri);
      }
    };

  return {
    executeHandler,
    interruptHandler,
    diagnostics,
    handleNotebookClosed,
  };
}

/** One `NotebookCellOutput` carrying VS Code's own built-in error mime
 * (`application/vnd.code.notebook.error`), the same factory 9a's own
 * placeholder used. */
async function appendError(
  execution: vscode.NotebookCellExecution,
  message: string,
): Promise<void> {
  await execution.appendOutput(
    new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.error(new Error(message)),
    ]),
  );
}

/** Turns one streamed {@link RichOutput} into what the cell shows — see this
 * module's own doc comment ("Output — what renders here (9c)") for the
 * mime-by-mime reasoning. `./notebookRender.ts`'s `toNotebookOutputPieces`
 * decides *what* each mime arm becomes; this is the one place that turns
 * that plain, `vscode`-free data into a real `vscode.NotebookCellOutputItem`.
 * Exported (rather than kept module-private,
 * like `appendError`) because it is the one piece of this module's own logic
 * the recorded-connection test fixture cannot drive end to end — 3c-i's own
 * `getFiles`/`getDirectoryMembers` simulated wire never writes to the working
 * directory, so no `text/html`/`image/png` `RichOutput` ever reaches a real
 * `ProcPythonBackend` running against it — see `test/integration/notebook/
 * execution.test.ts`'s own tests for this function, driven directly with a
 * synthetic `RichOutput` rather than through a real run.
 *
 * `imageIndex` gives an image piece the same "Output image {0}" alt text
 * `resultPanelModel.ts`'s own `labels.imageAlt` gives the result panel —
 * adversarial review, 2026-09-14 (Finding 9). `executeCell`'s own call site
 * counts image outputs as they stream and passes the running total; a caller
 * with only one image to append (this file's own tests included) can leave
 * it at the default. VS Code's own built-in renderer reads it from
 * `NotebookCellOutput.metadata.vscode_altText`
 * (`notebook-renderers/src/index.ts`'s `getAltText`), not from the output
 * item itself. */
export async function appendRichOutput(
  execution: vscode.NotebookCellExecution,
  output: RichOutput,
  imageIndex = 1,
): Promise<void> {
  const labels = {
    svgDropped: vscode.l10n.t(
      '[an SVG figure is not shown in a notebook cell — pass filetype="png" to SAS.show]',
    ),
  };
  for (const piece of toNotebookOutputPieces(output, labels)) {
    if (piece.kind === "stdout") {
      await execution.appendOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.stdout(piece.text),
        ]),
      );
    } else if (piece.kind === "html") {
      await execution.appendOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(piece.markup, "text/html"),
        ]),
      );
    } else {
      const item = new vscode.NotebookCellOutputItem(
        Buffer.from(piece.base64, "base64"),
        "image/png",
      );
      await execution.appendOutput(
        new vscode.NotebookCellOutput([item], {
          vscode_altText: vscode.l10n.t("Output image {0}", String(imageIndex)),
        }),
      );
    }
  }
}
