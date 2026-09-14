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
 * (`../run/backendCache`) this module now depends on rather than building its
 * own cache.
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
 * ## Output — what renders here, and what 9c still owns
 *
 * `text/plain` output renders in the cell as it streams, via
 * `NotebookCellOutputItem.stdout` — VS Code's own "this is a running
 * program's console output" mime, chosen over the generic `.text()` for the
 * same reason `outputChannel.ts` appends raw text rather than writing one
 * line at a time: a `print()`-heavy cell should read as one continuous
 * stream, not a wall of separately-bordered output blocks.
 *
 * `text/html` and `image/png` are **not** rendered inline yet — reported with
 * one honest placeholder line each, the same shape `outputChannel.ts` already
 * uses for the same two mime arms (`../run/render`'s own doc comment explains
 * why a text-only surface cannot show them; a notebook cell is not text-only,
 * but nothing here renders them for real yet either). `docs/phases/
 * phase-9.md`'s 9c slice is where a real per-mime-type notebook renderer
 * script lands, in upstream's `LogRenderer.ts`/`HTMLRenderer.ts` shape — this
 * slice does not reach for VS Code core's own built-in `text/html`/
 * `image/png` renderers as a shortcut, because whether those render
 * unmodified with no `ms-toolsai.jupyter` installed is exactly the kind of
 * client-side VS Code question 9a's own spike answered for `.ipynb` itself
 * and 9c has not yet answered for these — guessing would repeat the mistake
 * ADR-0024 exists to avoid.
 *
 * `application/vnd.python.traceback` produces no separate cell output at
 * all — its content already arrived as ordinary `text/plain` output ahead of
 * it (`../run/render`'s own doc comment: `logFilter.ts`'s `isNoiseLine` passes
 * a real exception's log lines straight through), and a raised cell already
 * gets VS Code's own red-X execution-failure indicator from this module's
 * `execution.end(false, …)` call. 9c's diagnostics-porting spike is where a
 * *structured*, clickable rendering of the same failure (a Problems-panel
 * entry against the cell's own `vscode-notebook-cell:` URI) may add a second,
 * different use for the same `Traceback` — not a second text rendering of it.
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
 */

import * as vscode from "vscode";

import type { ExecutionHandle, Program, RichOutput } from "../backend/backend";
import { localiseBackendProblem } from "../backend/messages";
import type { ProcPythonBackend } from "../backend/procPython";
import type { BackendCache } from "../run/backendCache";
import { renderRichOutput } from "../run/render";

/** The id VS Code's kernel picker and `NotebookController.dispose()` key on. */
export const NOTEBOOK_CONTROLLER_ID = "pythonOnViya.viyaNotebookKernel";

/** Owned by VS Code's own bundled `vscode.ipynb` extension, not this one. */
export const NOTEBOOK_TYPE = "jupyter-notebook";

/**
 * Registers the controller against the real {@link NOTEBOOK_CONTROLLER_ID}/
 * {@link NOTEBOOK_TYPE} and pushes it on `context.subscriptions`.
 *
 * `backendCache` is the same instance `extension.ts` hands
 * `registerRunCommands` — see `../run/backendCache`'s own doc comment for why
 * sharing one instance between Run File and this controller matters.
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
  context.subscriptions.push(controller);

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
}

/**
 * Builds the execution logic against `backendCache` — no real
 * `vscode.NotebookController` needed to construct this, only to run cells
 * against (each cell execution is created via whichever `controller`
 * `executeHandler` itself is called with, per the VS Code API's own contract
 * — see {@link NotebookExecutionHandlers}'s doc comment for why that is
 * still enough to test this seam directly).
 */
export function createNotebookExecutionHandlers(
  backendCache: BackendCache,
  log: vscode.LogOutputChannel,
): NotebookExecutionHandlers {
  // See this module's own doc comment ("Why one module-scoped `currentRun`
  // slot is safe") for why a single slot, not one per notebook or per cell,
  // is the right amount of state here.
  let currentRun:
    | { readonly backend: ProcPythonBackend; readonly handle: ExecutionHandle }
    | undefined;
  // Jupyter's own convention — the `[N]:` a cell shows next to its output —
  // ported as a plain incrementing counter, the same shape
  // `NotebookCellExecution.executionOrder` exists for.
  let executionOrder = 0;

  const executeCell = async (
    cell: vscode.NotebookCell,
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

    const handle = executed.value;
    currentRun = { backend, handle };
    try {
      for await (const output of handle.outputs) {
        await appendRichOutput(execution, output);
      }
      const settled = await handle.done;
      if (!settled.ok) {
        log.warn(settled.reason);
        await appendError(execution, localiseBackendProblem(settled.problem));
        execution.end(false, Date.now());
        return;
      }
      execution.end(settled.value.succeeded, Date.now());
    } finally {
      currentRun = undefined;
    }
  };

  const executeHandler: NotebookExecutionHandlers["executeHandler"] = async (
    cells,
    _notebook,
    controller,
  ) => {
    // Cells run one at a time, in order — `NotebookCellExecution`'s own
    // contract (only one execution per cell, and `ProcPythonBackend`'s own
    // serial contract underneath it) makes this the natural shape rather
    // than a design choice this slice had to make.
    for (const cell of cells) {
      await executeCell(cell, controller);
    }
  };

  const interruptHandler: NotebookExecutionHandlers["interruptHandler"] =
    async () => {
      if (currentRun === undefined) return;
      // Finding 75/76 apply here exactly as they do to Run File's own Cancel
      // (`commands.ts`'s `cancelRun`): a failed server-side cancel is logged,
      // not silently discarded, and even a successful one does not guarantee
      // a step already in flight stops before its own natural end — the
      // cell's own output will show whatever the run's `handle.done`
      // ultimately settles with, same as it would for any other failure.
      const cancelled = await currentRun.backend.cancel(currentRun.handle);
      if (!cancelled.ok) log.warn(cancelled.reason);
    };

  return { executeHandler, interruptHandler };
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
 * module's own doc comment ("Output — what renders here, and what 9c still
 * owns") for the mime-by-mime reasoning. Reuses `../run/render`'s own
 * fixture-tested reduction rather than re-deciding which mime arms render
 * inline and which defer. */
async function appendRichOutput(
  execution: vscode.NotebookCellExecution,
  output: RichOutput,
): Promise<void> {
  for (const line of renderRichOutput(output)) {
    if (line.kind === "raw") {
      await execution.appendOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.stdout(line.text),
        ]),
      );
      continue;
    }
    await execution.appendOutput(
      new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.stdout(
          line.mime === "image/png"
            ? vscode.l10n.t(
                "[an image was produced — rich rendering in a notebook cell isn't implemented yet]\n",
              )
            : vscode.l10n.t(
                "[an HTML table was produced — rich rendering in a notebook cell isn't implemented yet]\n",
              ),
        ),
      ]),
    );
  }
}
