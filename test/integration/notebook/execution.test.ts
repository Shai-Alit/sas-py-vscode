// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Phase 9b's own new surface: `createNotebookExecutionHandlers`, driving a
 * real `ProcPythonBackend` over a simulated wire — the same technique
 * `commands-backend.test.ts` uses for `commands.ts`'s own backend-dependent
 * paths, and for the same reason its own doc comment gives: there is no
 * injectable backend factory (`../../../src/run/backendCache.ts`'s own
 * `createBackendCache` hardcodes `new ProcPythonBackend(...)`), so a real
 * `ProcPythonBackend` over `test/helpers/recorded-connection.ts`'s simulated
 * wire is the only way to reach these paths without duplicating the logic
 * under test into a fake.
 *
 * This suite calls `createNotebookExecutionHandlers` directly rather than
 * `registerNotebookController` — `notebookController.ts`'s own doc comment
 * explains why: `executeHandler`/`interruptHandler` are plain functions of
 * the exact shape `vscode.NotebookController` itself declares, so a test can
 * call them with no `notebook.execute` command dispatch and no dependency on
 * which kernel a real user would have selected. `controller.test.ts`'s own
 * 9a regression is the complementary proof — that the real controller really
 * is selectable with no Jupyter extension installed — and deliberately does
 * not duplicate what this suite covers.
 *
 * `controller` is a fake, not a real `vscode.NotebookController`, and that is
 * deliberate rather than a shortcut: a real `NotebookController`'s
 * `createNotebookCellExecution` refuses with "notebook controller is NOT
 * associated to notebook" unless VS Code's own kernel-picker state already
 * selected it for that notebook — state this suite has no reason to fight,
 * since nothing under test here depends on kernel selection (that is
 * `controller.test.ts`'s own job). `NotebookController`/`NotebookCell`/
 * `NotebookCellExecution` are plain structural interfaces (`@types/vscode`),
 * not classes, so a fake satisfying only the members `executeCell`/
 * `executeHandler`/`interruptHandler` actually call is exactly the same
 * "fake the vscode surface that isn't the thing under test" shape
 * `commands.test.ts`'s own `fakeOutputChannel()` already uses. `cell` itself
 * stays real — `openCell` below opens a genuine notebook — since faking a
 * `TextDocument` well enough for `cell.document.getText()`/`.uri` to be
 * trustworthy is more ceremony than the real thing costs.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  appendRichOutput,
  createNotebookExecutionHandlers,
  NOTEBOOK_TYPE,
} from "../../../src/notebook/notebookController";
import { createBackendCache } from "../../../src/run/backendCache";
import { RunDiagnostics } from "../../../src/run/diagnostics";
import { testLogChannel } from "../../helpers/auth-host";
import {
  createRecordedConnection,
  type RecordedConnection,
} from "../../helpers/recorded-connection";

/** Same technique `commands-backend.test.ts` uses to let a held promise's
 * continuations run before the next assertion — safe here because every
 * `vscode` call this suite's own fakes make (`clearOutput`/`appendOutput`)
 * resolves on the spot, so nothing in the chain crosses a real extension-host
 * round trip the way a genuine `NotebookCellExecution` would. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const PROFILE_ID = "p1";
const PROFILE_NAME = "verde";

/** A `BackendCacheSessions` whose `connect()` hands back whichever
 * `RecordedConnection` the test last pointed it at — same shape
 * `commands-backend.test.ts`'s own `recordedSessions()` uses, narrowed to
 * what `createBackendCache` actually needs (no `forgetProfile`, which this
 * suite never exercises). */
function recordedSessions(initial: RecordedConnection): {
  connect: () => Promise<RecordedConnection["connection"]>;
  isBusy: () => boolean;
  startSubmission: () => boolean;
  endSubmission: () => void;
  setConnection(next: RecordedConnection): void;
} {
  let current = initial;
  return {
    connect: () => Promise.resolve(current.connection),
    isBusy: () => false,
    startSubmission: () => true,
    endSubmission: () => {
      /* no-op — see commands-backend.test.ts's own fake for why */
    },
    setConnection(next) {
      current = next;
    },
  };
}

/** What this suite reads back out of a fake execution — the two things
 * `NotebookCellExecution` has no public getter for on the real interface
 * either (`cell.outputs`/`cell.executionSummary` mirror it on a real
 * notebook document; this fake just remembers directly, with no replication
 * delay to poll through). */
interface FakeExecution {
  readonly execution: vscode.NotebookCellExecution;
  outputs(): readonly vscode.NotebookCellOutput[];
  ended(): { readonly success: boolean | undefined } | undefined;
}

function fakeExecution(cell: vscode.NotebookCell): FakeExecution {
  let outputs: vscode.NotebookCellOutput[] = [];
  let ended: { success: boolean | undefined } | undefined;
  // Not `Array.isArray`: its type predicate is `arg is any[]` regardless of
  // the union's actual element type, which is exactly what
  // `@typescript-eslint/no-unsafe-*` flags. `items` is `NotebookCellOutput`'s
  // own distinguishing property, so an `in` check narrows the union safely.
  const toArray = (
    out: vscode.NotebookCellOutput | readonly vscode.NotebookCellOutput[],
  ): vscode.NotebookCellOutput[] => ("items" in out ? [out] : [...out]);

  const execution: Partial<vscode.NotebookCellExecution> = {
    cell,
    start: () => {
      /* no-op */
    },
    end: (success) => {
      ended = { success };
    },
    clearOutput: () => {
      outputs = [];
      return Promise.resolve();
    },
    replaceOutput: (out) => {
      outputs = toArray(out);
      return Promise.resolve();
    },
    appendOutput: (out) => {
      outputs.push(...toArray(out));
      return Promise.resolve();
    },
  };

  return {
    // `notebookController.ts` never reads any member beyond the ones set
    // above — see this file's own doc comment for why a full, real
    // `NotebookCellExecution` is not worth building here.
    execution: execution as vscode.NotebookCellExecution,
    outputs: () => outputs,
    ended: () => ended,
  };
}

/** A fake `vscode.NotebookController` whose only real behaviour is handing
 * back a {@link fakeExecution} per cell, recorded in `executions` so a test
 * can read back what a cell's own run did. See this file's own doc comment
 * for why a real controller is the wrong tool here. */
function fakeController(
  executions: Map<vscode.NotebookCell, FakeExecution>,
): vscode.NotebookController {
  const controller: Partial<vscode.NotebookController> = {
    createNotebookCellExecution: (cell) => {
      const created = fakeExecution(cell);
      executions.set(cell, created);
      return created.execution;
    },
  };
  return controller as vscode.NotebookController;
}

describe("notebook execution (9b)", () => {
  const log = testLogChannel("notebook execution");
  let disposables: vscode.Disposable[] = [];

  afterEach(() => {
    for (const disposable of disposables) disposable.dispose();
    disposables = [];
  });

  async function openCell(
    source: string,
  ): Promise<{ notebook: vscode.NotebookDocument; cell: vscode.NotebookCell }> {
    const notebook = await vscode.workspace.openNotebookDocument(
      NOTEBOOK_TYPE,
      new vscode.NotebookData([
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Code,
          source,
          "python",
        ),
      ]),
    );
    return { notebook, cell: notebook.cellAt(0) };
  }

  function textOf(output: vscode.NotebookCellOutput): string {
    return output.items
      .map((item) => new TextDecoder().decode(item.data))
      .join("");
  }

  /** `appendError`'s own output — `NotebookCellOutputItem.error()`'s built-in
   * mime, carrying `{name, message, stack}` as JSON rather than plain text
   * (`controller.test.ts`'s own 9a test decodes the same shape). */
  function errorMessageOf(output: vscode.NotebookCellOutput): string {
    const item = output.items[0];
    assert.ok(item);
    assert.equal(item.mime, "application/vnd.code.notebook.error");
    const decoded: unknown = JSON.parse(new TextDecoder().decode(item.data));
    return (decoded as { message: string }).message;
  }

  it("streams text/plain output into the cell as it arrives and ends with success", async () => {
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const backendCache = createBackendCache(sessions, log);
    disposables.push(backendCache);
    const handlers = createNotebookExecutionHandlers(backendCache, log);
    const executions = new Map<vscode.NotebookCell, FakeExecution>();
    const controller = fakeController(executions);
    const { notebook, cell } = await openCell(
      "print('hello from the notebook')",
    );

    const executing = handlers.executeHandler([cell], notebook, controller);
    await flush();
    const job = recorded.currentJob();
    assert.ok(
      job !== undefined,
      "execute() should have created a job before this assertion",
    );
    job.push("hello from the notebook\n");
    job.finish(true, undefined);
    await executing;

    const result = executions.get(cell);
    assert.ok(result);
    assert.ok(
      result
        .outputs()
        .some((output) => textOf(output).includes("hello from the notebook")),
      `expected the streamed text to reach the cell; got: ${JSON.stringify(
        result.outputs().map((output) => output.items.map((item) => item.mime)),
      )}`,
    );
    assert.equal(
      result.ended()?.success,
      true,
      "a run that did not raise should end with VS Code's own success indicator",
    );
  });

  it("reports a busy backend as cell output and never starts a second run", async () => {
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const backendCache = createBackendCache(sessions, log);
    disposables.push(backendCache);
    const handlers = createNotebookExecutionHandlers(backendCache, log);
    const executions = new Map<vscode.NotebookCell, FakeExecution>();
    const controller = fakeController(executions);
    const first = await openCell("print(1)");
    const second = await openCell("print(2)");

    const firstRun = handlers.executeHandler(
      [first.cell],
      first.notebook,
      controller,
    );
    await flush();
    assert.ok(
      recorded.currentJob() !== undefined,
      "the first cell's run should have created its own job before this test proceeds",
    );

    // The second cell's own `backend.busy` check refuses before ever calling
    // `execute()` again — same guard, same reasoning, as `commands.ts`'s own
    // `runNow` (`notebookController.ts`'s own doc comment, "Why one
    // module-scoped currentRun slot is safe").
    await handlers.executeHandler([second.cell], second.notebook, controller);
    const secondResult = executions.get(second.cell);
    assert.ok(secondResult);
    assert.equal(secondResult.outputs().length, 1);
    const secondOutput = secondResult.outputs()[0];
    assert.ok(secondOutput);
    assert.match(errorMessageOf(secondOutput), /already running/i);
    assert.equal(secondResult.ended()?.success, false);

    recorded.currentJob()?.finish(true, undefined);
    await firstRun;
  });

  it("shows an honest waiting notice once the delay elapses with no output", async () => {
    // Manual-test §9.8: a cell can sit with no output for reasons the
    // client cannot distinguish (a slow program vs. a previous statement
    // still finishing server-side, Finding 76) — `waitingNoticeDelayMs` lets
    // this test shrink the real 3-second wait to something an integration
    // run can afford.
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const backendCache = createBackendCache(sessions, log);
    disposables.push(backendCache);
    const handlers = createNotebookExecutionHandlers(backendCache, log, 10);
    const executions = new Map<vscode.NotebookCell, FakeExecution>();
    const controller = fakeController(executions);
    const { notebook, cell } = await openCell("import time; time.sleep(1)");

    const executing = handlers.executeHandler([cell], notebook, controller);
    await flush();
    const job = recorded.currentJob();
    assert.ok(job !== undefined);

    // Nothing pushed yet — let the notice's own delay elapse for real.
    await new Promise((resolve) => setTimeout(resolve, 30));
    job.push("done\n");
    job.finish(true, undefined);
    await executing;

    const result = executions.get(cell);
    assert.ok(result);
    assert.ok(
      result
        .outputs()
        .some((output) => textOf(output).includes("still no output")),
      `expected the waiting notice once the delay elapsed; got: ${JSON.stringify(
        result.outputs().map(textOf),
      )}`,
    );
  });

  it("never shows the waiting notice once output has already started streaming", async () => {
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const backendCache = createBackendCache(sessions, log);
    disposables.push(backendCache);
    const handlers = createNotebookExecutionHandlers(backendCache, log, 10);
    const executions = new Map<vscode.NotebookCell, FakeExecution>();
    const controller = fakeController(executions);
    const { notebook, cell } = await openCell("print('right away')");

    const executing = handlers.executeHandler([cell], notebook, controller);
    await flush();
    const job = recorded.currentJob();
    assert.ok(job !== undefined);
    // Output arrives well before the (already short) delay, and stays that
    // way for longer than it — the notice must not appear regardless.
    job.push("right away\n");
    await new Promise((resolve) => setTimeout(resolve, 30));
    job.finish(true, undefined);
    await executing;

    const result = executions.get(cell);
    assert.ok(result);
    assert.ok(
      !result
        .outputs()
        .some((output) => textOf(output).includes("still no output")),
      `did not expect the waiting notice once real output had streamed; got: ${JSON.stringify(
        result.outputs().map(textOf),
      )}`,
    );
  });

  it("cancels the in-flight cell via interruptHandler", async () => {
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const backendCache = createBackendCache(sessions, log);
    disposables.push(backendCache);
    const handlers = createNotebookExecutionHandlers(backendCache, log);
    const executions = new Map<vscode.NotebookCell, FakeExecution>();
    const controller = fakeController(executions);
    const { notebook, cell } = await openCell("while True: pass");

    const executing = handlers.executeHandler([cell], notebook, controller);
    await flush();
    assert.ok(
      recorded.currentJob() !== undefined,
      "the run should have created its own job before this test proceeds",
    );

    await handlers.interruptHandler(notebook);
    await executing;

    const result = executions.get(cell);
    assert.ok(result);
    assert.equal(result.ended()?.success, false);
    assert.equal(result.outputs().length, 1);
    const output = result.outputs()[0];
    assert.ok(output);
    assert.ok(
      errorMessageOf(output).startsWith("Cancelled."),
      `expected the interrupted run's own cancellation to reach the cell; got: ${errorMessageOf(output)}`,
    );

    // A cell run after the interrupt should reach a fresh `execute()` rather
    // than being refused as busy — proving `currentRun` was actually cleared
    // in the `finally`, not left pointing at the cancelled run.
    const another = await openCell("print('still usable')");
    const secondRun = handlers.executeHandler(
      [another.cell],
      another.notebook,
      controller,
    );
    await flush();
    const secondJob = recorded.currentJob();
    assert.ok(
      secondJob !== undefined,
      "a later cell should still be able to start a run after the interrupt",
    );
    secondJob.push("still usable\n");
    secondJob.finish(true, undefined);
    await secondRun;
    assert.equal(executions.get(another.cell)?.ended()?.success, true);
  });

  it("does not cancel a different notebook's in-flight cell", async () => {
    // Regression case for the adversarial-review finding
    // (`notebookController.ts`'s own doc comment, "Why one module-scoped
    // currentRun slot is safe"): `interruptHandler` used to cancel whatever
    // `currentRun` held regardless of which notebook it was actually called
    // for. Notebook B here never runs anything through this shared backend
    // — `currentRun` only ever points at A's own job — but VS Code can still
    // call `interruptHandler(B)`, e.g. from B's own queued cell showing
    // "running" chrome while it is really about to be busy-refused. That
    // must not reach A's genuinely running job.
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const backendCache = createBackendCache(sessions, log);
    disposables.push(backendCache);
    const handlers = createNotebookExecutionHandlers(backendCache, log);
    const executions = new Map<vscode.NotebookCell, FakeExecution>();
    const controller = fakeController(executions);
    const a = await openCell("while True: pass");
    const b = await openCell("print('b never ran')");

    const runningA = handlers.executeHandler([a.cell], a.notebook, controller);
    await flush();
    const job = recorded.currentJob();
    assert.ok(
      job !== undefined,
      "notebook A's run should have created its own job before this test proceeds",
    );

    await handlers.interruptHandler(b.notebook);

    job.push("still running\n");
    job.finish(true, undefined);
    await runningA;

    const result = executions.get(a.cell);
    assert.ok(result);
    assert.equal(
      result.ended()?.success,
      true,
      "notebook B's interrupt must not have cancelled notebook A's own run",
    );
    assert.ok(
      result
        .outputs()
        .some((output) => textOf(output).includes("still running")),
      `expected A's own streamed output to have arrived uninterrupted; got: ${JSON.stringify(
        result.outputs().map(textOf),
      )}`,
    );
  });

  describe("rich output rendering (9c)", () => {
    // `appendRichOutput` is driven directly with a synthetic `RichOutput`
    // rather than through a real run — `notebookController.ts`'s own doc
    // comment on this function explains why: the recorded-connection wire's
    // `getFiles`/`getDirectoryMembers` never produces a real `text/html`/
    // `image/png` output for `handle.outputs` to stream.

    it("renders text/html as a real text/html cell output", async () => {
      const { cell } = await openCell("pass");
      const created = fakeExecution(cell);

      await appendRichOutput(created.execution, {
        mime: "text/html",
        data: "<table></table>",
      });

      const outputs = created.outputs();
      assert.equal(outputs.length, 1);
      const item = outputs[0]?.items[0];
      assert.ok(item);
      assert.equal(item.mime, "text/html");
      assert.equal(new TextDecoder().decode(item.data), "<table></table>");
    });

    it("renders image/png as a real image/png cell output", async () => {
      const { cell } = await openCell("pass");
      const created = fakeExecution(cell);
      const base64 = Buffer.from("not really a png, just bytes").toString(
        "base64",
      );

      await appendRichOutput(created.execution, {
        mime: "image/png",
        data: base64,
      });

      const outputs = created.outputs();
      assert.equal(outputs.length, 1);
      const item = outputs[0]?.items[0];
      assert.ok(item);
      assert.equal(item.mime, "image/png");
      assert.equal(Buffer.from(item.data).toString("base64"), base64);
    });

    it("renders nothing for a structured traceback — already streamed as text/plain", async () => {
      const { cell } = await openCell("pass");
      const created = fakeExecution(cell);

      await appendRichOutput(created.execution, {
        mime: "application/vnd.python.traceback",
        data: { message: "ZeroDivisionError: division by zero", frames: [] },
      });

      assert.equal(created.outputs().length, 0);
    });
  });

  describe("Problems-panel diagnostics (9c)", () => {
    // Same wire this suite's other tests drive — `commands-diagnostics
    // .test.ts`'s own `TRACEBACK_LINES` shape, forwarded verbatim by the
    // simulated wire since every pushed line is `type: "normal"`
    // (`logFilter.ts` does not treat that as noise).
    const TRACEBACK_LINES = [
      "Traceback (most recent call last):",
      '  File "<string>", line 1, in <module>',
      "ZeroDivisionError: division by zero",
    ];

    it("publishes one Problems-panel entry for a raised cell, then clears it on the next run", async () => {
      const recorded = createRecordedConnection({
        profileId: PROFILE_ID,
        profileName: PROFILE_NAME,
      });
      const sessions = recordedSessions(recorded);
      const backendCache = createBackendCache(sessions, log);
      disposables.push(backendCache);
      const collection = vscode.languages.createDiagnosticCollection(
        "test-notebook-diagnostics",
      );
      disposables.push(collection);
      const diagnostics = new RunDiagnostics({
        createCollection: () => collection,
      });
      const handlers = createNotebookExecutionHandlers(
        backendCache,
        log,
        undefined,
        diagnostics,
      );
      const executions = new Map<vscode.NotebookCell, FakeExecution>();
      const controller = fakeController(executions);
      const { notebook, cell } = await openCell("a = 1 / 0");

      const executing = handlers.executeHandler([cell], notebook, controller);
      await flush();
      const job = recorded.currentJob();
      assert.ok(job !== undefined);
      for (const line of TRACEBACK_LINES) job.push(line);
      job.finish(false, "ZeroDivisionError: division by zero");
      await executing;

      const published = collection.get(cell.document.uri) ?? [];
      assert.equal(published.length, 1);
      const diagnostic = published[0];
      assert.ok(diagnostic);
      assert.equal(diagnostic.message, "ZeroDivisionError: division by zero");
      assert.equal(diagnostic.source, "Python on Viya");

      // The same cell run again clears the prior entry — `executeCell` calls
      // `clearFor` as soon as `execute()` succeeds, before this run even
      // produces output, exactly where `commands.ts`'s own `runNow` does.
      const secondRun = handlers.executeHandler([cell], notebook, controller);
      await flush();
      const job2 = recorded.currentJob();
      assert.ok(job2 !== undefined);
      assert.notEqual(job2, job, "a fresh job for the second run");
      job2.push("done\n");
      job2.finish(true, undefined);
      await secondRun;

      assert.deepEqual([...(collection.get(cell.document.uri) ?? [])], []);
    });
  });
});
