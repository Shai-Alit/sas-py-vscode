// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `commands.ts` paths that only exist once a real backend is running —
 * `docs/phases/phase-4.md`'s 4a slice.
 *
 * `commands.test.ts`'s own guard suite is deliberately thin: every case in it
 * reaches its refusal before `backendFor()` would ever call
 * `sessions.connect()`, and `sessionsThatMustNotConnect()` throws if one
 * slips through. That is the right suite for guard logic, and the wrong one
 * for what this file covers — three paths named in 4a's own Runbook entry
 * that only exist once a `ProcPythonBackend` is actually running against a
 * session:
 *
 * - `backendFor()`'s reconnect-orphan `close()` — a still-busy cached backend
 *   closed before being overwritten, when a new `ComputeConnection` arrives
 *   for the same profile.
 * - `cancelRun`'s `currentReset` fallback — interrupting an in-flight
 *   `reset()` via `close()`, since a reset produces no `ExecutionHandle` for
 *   Cancel to find.
 * - The `backend.busy` serialisation guard in `runNow`/`resetPythonState` —
 *   stopping a second invocation from clobbering `currentRun`/`currentReset`
 *   in the shared `finally`, found on 3d-i's own second review pass.
 *
 * `test/helpers/recorded-connection.ts` is what makes this possible: a real
 * `ComputeConnection`, over a simulated wire, that `backendFor()`'s own `new
 * ProcPythonBackend(...)` runs against unmodified — there is no injectable
 * backend factory (`commands.ts:326`), so this is the only way to reach these
 * paths without duplicating the logic under test into a fake.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { createProfile } from "../../../src/profile/model";
import {
  createRunCommandHandlers,
  type RunCommandDeps,
  type RunCommandProfiles,
  type RunCommandSessions,
} from "../../../src/run/commands";
import { EnvironmentStore } from "../../../src/run/environmentStore";
import { RunOutputChannel } from "../../../src/run/outputChannel";
import {
  RunTargetStore,
  type RunTargetProfileSource,
} from "../../../src/run/targetStore";
import { memoryMemento, testLogChannel } from "../../helpers/auth-host";
import {
  createRecordedConnection,
  type RecordedConnection,
} from "../../helpers/recorded-connection";

/** Same technique `compute-log-stream.test.ts` and `proc-python-backend.test.ts`
 * already use to let a held promise's continuations run before the next
 * assertion: a `setTimeout(resolve, 0)` schedules after every microtask
 * queued so far, including the chain of `await`s `backendFor()`/`execute()`/
 * `reset()` and the simulated wire's own `send()` calls produce with no real
 * I/O in between. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const PROFILE_ID = "p1";
const PROFILE_NAME = "verde";

function fakeProfiles(): RunCommandProfiles & RunTargetProfileSource {
  const profile = createProfile({
    id: PROFILE_ID,
    endpoint: "https://viya.example.com",
  });
  return {
    names: () => [PROFILE_NAME],
    get: (name) => (name === PROFILE_NAME ? profile : undefined),
    setActiveName: () => Promise.resolve(),
    active: () => ({ name: PROFILE_NAME, profile }),
    onDidChange: new vscode.EventEmitter<void>().event,
  };
}

/**
 * A `RunCommandSessions` whose `connect()` hands back whichever
 * `RecordedConnection` the test last pointed it at — `setConnection` is how a
 * test simulates a reconnect landing between two calls.
 *
 * `isBusy`/`startSubmission`/`endSubmission` are unconditionally permissive,
 * the same shape `commands.test.ts`'s own `sessionsThatMustNotConnect()` gives
 * them for cases that never reach a real submission. That is deliberate here
 * too: `ComputeSessionManager`'s own cross-window submission guard is a
 * different concern (3a-ii's own suite covers it), and every case in this file
 * is about `ProcPythonBackend.busy`'s *instance-level* flag — whether `this
 * .active` is set — not about arbitrating two backends sharing one profile's
 * guard. A permissive fake keeps that the only thing under test.
 */
function recordedSessions(initial: RecordedConnection): RunCommandSessions & {
  setConnection(next: RecordedConnection): void;
} {
  let current = initial;
  return {
    connect: () => Promise.resolve(current.connection),
    isBusy: () => false,
    startSubmission: () => true,
    endSubmission: () => {
      /* no-op — see this function's own doc comment */
    },
    forgetProfile: () => {
      /* not exercised by any case in this file */
    },
    setConnection(next) {
      current = next;
    },
  };
}

/** Records every line written to it, so a test can assert on the transcript
 * without a real `vscode.window.createOutputChannel` — same reasoning as
 * `commands.test.ts`'s own `fakeOutputChannel()`, extended to actually keep
 * what was written rather than discarding it, since these tests need to
 * confirm *what* a run or a reset concluded with. */
function recordingOutputChannel(): {
  readonly lines: string[];
  readonly channel: vscode.OutputChannel;
} {
  const lines: string[] = [];
  return {
    lines,
    channel: {
      name: "fake",
      append: (value) => lines.push(value),
      appendLine: (value) => lines.push(value),
      replace: () => {
        /* no-op */
      },
      clear: () => {
        lines.length = 0;
      },
      show: () => {
        /* no-op */
      },
      hide: () => {
        /* no-op */
      },
      dispose: () => {
        /* no-op */
      },
    },
  };
}

/**
 * A `withProgress` that runs the callback immediately against a real,
 * never-cancelled token — the same technique `session-manager.test.ts` uses
 * ("Run the work with a token nobody cancels, so no progress UI appears in a
 * test run") rather than a hand-rolled `CancellationToken` double. Every case
 * in this file drives cancellation through `handlers.cancelRun()` directly,
 * never through a progress notification's own Cancel button.
 */
function bypassProgress(): Pick<RunCommandDeps, "withProgress"> {
  return {
    withProgress: (_location, _title, _cancellable, run) => {
      const progress: vscode.Progress<{ message?: string }> = {
        report: () => {
          /* no-op */
        },
      };
      return run(progress, new vscode.CancellationTokenSource().token);
    },
  };
}

describe("run commands — backend paths (4a)", () => {
  const log = testLogChannel("run commands — backend paths");
  let torndown: (() => void)[] = [];

  afterEach(() => {
    for (const dispose of torndown) dispose();
    torndown = [];
  });

  /** Opens a Python document and makes it the active editor — `runFile()`
   * needs one; `resetPythonState()` does not read the editor at all. */
  async function pythonEditor(): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content: "print(1)\n",
    });
    return await vscode.window.showTextDocument(document);
  }

  function build(
    sessions: RunCommandSessions,
    deps: RunCommandDeps,
    outputChannel: vscode.OutputChannel,
  ) {
    const profiles = fakeProfiles();
    const targets = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles,
    );
    const environment = new EnvironmentStore({ globalState: memoryMemento() });
    const handlers = createRunCommandHandlers(
      sessions,
      profiles,
      targets,
      environment,
      log,
      vscode.Uri.file("/fake-extension"),
      {
        outputChannel: new RunOutputChannel({
          createChannel: () => outputChannel,
        }),
        ...bypassProgress(),
        ...deps,
      },
    );
    torndown.push(() => {
      handlers.dispose();
      targets.dispose();
    });
    return { targets, handlers };
  }

  it("closes a still-busy cached backend when a reconnect brings a new connection for the same profile", async () => {
    const first = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const second = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(first);
    const { lines, channel } = recordingOutputChannel();
    const editor = await pythonEditor();
    const { targets, handlers } = build(
      sessions,
      { activeTextEditor: () => editor },
      channel,
    );
    await targets.setKind("viya");

    // Backend A: started, and never told to finish — busy for as long as
    // this test lets it be.
    const orphaned = handlers.runFile();
    await flush();
    assert.ok(
      first.currentJob() !== undefined,
      "the first run should have created its own job before this test proceeds",
    );

    // A reconnect: the same profile, a different `ComputeConnection`. This is
    // what `backendFor()` reads as a reattach rather than the cache hit its
    // fast path otherwise takes.
    sessions.setConnection(second);
    const reconnected = handlers.runFile();
    await flush();
    assert.ok(
      second.currentJob() !== undefined,
      "the reconnect's own run should have started on a fresh backend, " +
        "proving backendFor() did not simply refuse as busy",
    );
    second.currentJob()?.finish(true, undefined);
    await reconnected;

    // Backend A's own job was never told to finish. If `orphaned` settles
    // anyway, it is because `backendFor()` closed the orphaned backend out
    // from under itself — cancelling whatever it still had running — rather
    // than leaving a SAS process nothing in this window can reach again
    // until the idle reaper takes it.
    await orphaned;
    assert.ok(
      // Reworded, Phase 4c's Finding 76: the full sentence now also caveats
      // that a step already in flight may keep running on Viya — matching
      // on the leading "Cancelled." is what survives that wording changing
      // again without this test caring what the caveat itself says.
      lines.some((line) => line.startsWith("Cancelled.")),
      `expected the orphaned run's own output to record its cancellation; got: ${JSON.stringify(lines)}`,
    );
  });

  it("interrupts an in-flight reset via close() when Cancel finds no run handle", async () => {
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
      // The default (`true`) finishes a `RESTART_STATEMENT` job the instant
      // it is created, which is exactly right for `recorded-proc-python.ts`'s
      // own consumer and exactly wrong here: this case needs the reset to
      // still be running when Cancel is invoked.
      autoFinishReset: false,
    });
    const sessions = recordedSessions(recorded);
    const { lines, channel } = recordingOutputChannel();
    const { targets, handlers } = build(sessions, {}, channel);
    await targets.setKind("viya");

    const resetting = handlers.resetPythonState();
    await flush();
    assert.ok(
      recorded.currentJob() !== undefined,
      "the reset should have created its own job before this test proceeds",
    );

    // No `ExecutionHandle` exists for a reset — `cancelRun`'s own doc comment
    // names this as exactly why it falls back to `currentReset.backend
    // .close()` rather than the `currentRun.backend.cancel(handle)` path a
    // Run File cancellation takes.
    await handlers.cancelRun();

    await resetting;
    assert.ok(
      // Reworded, Phase 4c's Finding 76: the full sentence now also caveats
      // that a step already in flight may keep running on Viya — matching
      // on the leading "Cancelled." is what survives that wording changing
      // again without this test caring what the caveat itself says.
      lines.some((line) => line.startsWith("Cancelled.")),
      `expected the interrupted reset to record its own cancellation; got: ${JSON.stringify(lines)}`,
    );
  });

  it("does not let a second runFile() invocation's own finally clear the first run's tracking while it is still busy", async () => {
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const { lines, channel } = recordingOutputChannel();
    const editor = await pythonEditor();
    const recorder = { reported: [] as string[], informed: [] as string[] };
    const { targets, handlers } = build(
      sessions,
      {
        activeTextEditor: () => editor,
        report: (message) => recorder.reported.push(message),
        inform: (message) => recorder.informed.push(message),
      },
      channel,
    );
    await targets.setKind("viya");

    const first = handlers.runFile();
    await flush();
    assert.ok(
      recorded.currentJob() !== undefined,
      "the first run should have created its own job before this test proceeds",
    );

    // A second Run File while the first is still busy: refused by the
    // explicit `backend.busy` check in `runNow`, before `currentRun` or the
    // try/finally around it are ever reached.
    await handlers.runFile();
    assert.equal(recorder.reported.length, 1);
    assert.ok(/already running/i.test(recorder.reported[0] ?? ""));

    // The regression this case pins: an earlier version of `runNow` let the
    // second invocation's own `finally` run regardless, clearing `currentRun`
    // and flipping `pythonOnViya.running` to `false` out from under the
    // *first*, still-running invocation. If that had happened here, Cancel
    // would now find nothing tracked and report "Nothing is running." —
    // instead it should still reach the first run's own handle.
    await handlers.cancelRun();
    assert.equal(
      recorder.informed.length,
      0,
      "cancelRun() should have reached the first run's own handle, not " +
        'the "nothing running" fallback',
    );

    await first;
    assert.ok(
      // Reworded, Phase 4c's Finding 76: the full sentence now also caveats
      // that a step already in flight may keep running on Viya — matching
      // on the leading "Cancelled." is what survives that wording changing
      // again without this test caring what the caveat itself says.
      lines.some((line) => line.startsWith("Cancelled.")),
      `expected the first run to have been reachable — and cancellable — through ` +
        `the second invocation's refusal; got: ${JSON.stringify(lines)}`,
    );
  });

  it("surfaces a failed backend cancel() instead of discarding it (Finding 75)", async () => {
    // An earlier version of `cancelRun` awaited `backend.cancel()` and threw
    // the result away unread — a server-side cancel failure (measured live:
    // a `428` before the `If-Match` fix; `412` from a stale `ETag` is the
    // residual race the fix cannot close) reached nobody. `failCancel` makes
    // the simulated job's `cancel` PUT answer that `412`.
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
      failCancel: true,
    });
    const sessions = recordedSessions(recorded);
    const { lines, channel } = recordingOutputChannel();
    const editor = await pythonEditor();
    const recorder = { reported: [] as string[] };
    const { targets, handlers } = build(
      sessions,
      {
        activeTextEditor: () => editor,
        report: (message) => recorder.reported.push(message),
      },
      channel,
    );
    await targets.setKind("viya");

    const run = handlers.runFile();
    await flush();
    assert.ok(
      recorded.currentJob() !== undefined,
      "the run should have created its own job before this test proceeds",
    );

    await handlers.cancelRun();
    await run;

    // The local run still stops regardless of the server-side outcome —
    // `LogStream`'s own abort settles `handle.done`, not `cancelJob`'s
    // reply (see that function's own doc comment) — so the output channel
    // still records the cancellation.
    assert.ok(
      lines.some((line) => line.startsWith("Cancelled.")),
      `expected the local run to still record its cancellation despite the ` +
        `failed server-side cancel; got: ${JSON.stringify(lines)}`,
    );
    // The regression this case pins: the failed `BackendResult` from
    // `backend.cancel()` must reach `reportProblem`, not be discarded.
    assert.equal(
      recorder.reported.length,
      1,
      `expected the failed server-side cancel to be reported exactly once; ` +
        `got: ${JSON.stringify(recorder.reported)}`,
    );
    assert.match(recorder.reported[0] ?? "", /Running on SAS Viya failed/);
  });
});
