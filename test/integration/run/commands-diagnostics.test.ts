// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `commands.ts` ↔ `RunDiagnostics` wiring — `docs/phases/phase-4.md`'s 4d
 * slice, the Problems-panel half.
 *
 * `RunDiagnostics` itself has its own suite (`diagnostics.test.ts`) against a
 * real `DiagnosticCollection`; this file covers the part that only exists
 * once a real run streams through `commands.ts`: `drainOutputs` capturing the
 * trailing `application/vnd.python.traceback` output, and `runNow` publishing
 * from it on a failed outcome and clearing it at the start of the next run.
 * The wire is the same simulated `ComputeConnection` `commands-backend.test.ts`
 * (4a) drives — see `test/helpers/recorded-connection.ts`.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { createProfile } from "../../../src/profile/model";
import {
  createRunCommandHandlers,
  type RunCommandDeps,
  type RunCommandHandlers,
  type RunCommandProfiles,
  type RunCommandSessions,
} from "../../../src/run/commands";
import { RunDiagnostics } from "../../../src/run/diagnostics";
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

/** `setTimeout(resolve, 0)` — schedules after every microtask queued so far,
 * the same drain `commands-backend.test.ts` uses between run phases. */
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

function recordedSessions(connection: RecordedConnection): RunCommandSessions {
  return {
    connect: () => Promise.resolve(connection.connection),
    isBusy: () => false,
    startSubmission: () => true,
    endSubmission: () => {
      /* no-op — see commands-backend.test.ts's own note on why permissive */
    },
    forgetProfile: () => {
      /* not exercised here */
    },
  };
}

/** A `withProgress` that runs the callback immediately and returns its value
 * — `runNow` now reads `drainOutputs`'s captured traceback back through it. */
function bypassProgress(): Pick<RunCommandDeps, "withProgress"> {
  return {
    withProgress: (_location, _title, _cancellable, run) =>
      run(
        { report: () => undefined },
        new vscode.CancellationTokenSource().token,
      ),
  };
}

/** A silent `vscode.OutputChannel` — these tests assert on the Problems
 * collection, not the transcript. */
function silentChannel(): vscode.OutputChannel {
  return {
    name: "fake",
    append: () => undefined,
    appendLine: () => undefined,
    replace: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  };
}

/** A `<string>`-frame traceback the simulated wire forwards verbatim (every
 * pushed line is `type: "normal"`, which `logFilter.ts` does not treat as
 * noise), shaped to satisfy `procPython.ts`'s `parseTraceback`. */
const TRACEBACK_LINES = [
  "Traceback (most recent call last):",
  '  File "<string>", line 5, in <module>',
  '  File "<string>", line 2, in divide',
  "ZeroDivisionError: division by zero",
];

describe("run commands — Problems-panel diagnostics (4d)", () => {
  const log = testLogChannel("run commands — diagnostics (4d)");
  let torndown: (() => void)[] = [];

  afterEach(() => {
    for (const dispose of torndown) dispose();
    torndown = [];
  });

  async function pythonEditor(): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content: "a = 1\nb = 2\nc = a / 0\n",
    });
    return await vscode.window.showTextDocument(document);
  }

  async function build(connection: RecordedConnection): Promise<{
    handlers: RunCommandHandlers;
    targets: RunTargetStore;
    collection: vscode.DiagnosticCollection;
    uri: vscode.Uri;
    document: vscode.TextDocument;
    /** Fires `commands.ts`'s injected close hook (Phase 5d-iv). */
    closeEmitter: vscode.EventEmitter<vscode.TextDocument>;
    /** Fires `commands.ts`'s injected sign-out hook (Phase 5d-iv). */
    signOutEmitter: vscode.EventEmitter<void>;
    /** Simulates the active profile changing while the target stays on Viya —
     * `RunTargetStore` re-fires its own `onDidChange` off this. */
    profileChanges: vscode.EventEmitter<void>;
  }> {
    const editor = await pythonEditor();
    const profiles = fakeProfiles();
    const profileChanges = new vscode.EventEmitter<void>();
    const targets = new RunTargetStore(
      { workspaceState: memoryMemento() },
      { ...profiles, onDidChange: profileChanges.event },
    );
    const environment = new EnvironmentStore({ globalState: memoryMemento() });
    const collection = vscode.languages.createDiagnosticCollection(
      "test-commands-diagnostics",
    );
    const closeEmitter = new vscode.EventEmitter<vscode.TextDocument>();
    const signOutEmitter = new vscode.EventEmitter<void>();
    const handlers = createRunCommandHandlers(
      recordedSessions(connection),
      profiles,
      targets,
      environment,
      log,
      vscode.Uri.file("/fake-extension"),
      {
        activeTextEditor: () => editor,
        outputChannel: new RunOutputChannel({
          createChannel: () => silentChannel(),
        }),
        diagnostics: new RunDiagnostics({ createCollection: () => collection }),
        onDidCloseTextDocument: closeEmitter.event,
        onDidSignOut: signOutEmitter.event,
        ...bypassProgress(),
      },
    );
    torndown.push(() => {
      handlers.dispose();
      targets.dispose();
      collection.dispose();
      closeEmitter.dispose();
      signOutEmitter.dispose();
      profileChanges.dispose();
    });
    return {
      handlers,
      targets,
      collection,
      uri: editor.document.uri,
      document: editor.document,
      closeEmitter,
      signOutEmitter,
      profileChanges,
    };
  }

  /** Drives one failing run to completion so a Problems entry is published,
   * then returns — the shared setup for every lifecycle-clear test below. */
  async function publishOneFailure(
    connection: RecordedConnection,
    handlers: RunCommandHandlers,
  ): Promise<void> {
    const failing = handlers.runFile();
    await flush();
    const job = connection.currentJob();
    assert.ok(job, "the run should have created its job");
    for (const line of TRACEBACK_LINES) job.push(line);
    job.finish(false, "ZeroDivisionError: division by zero");
    await failing;
  }

  it("publishes one error at the innermost mapped frame on a failed run, then clears it on the next run", async () => {
    const connection = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const { handlers, targets, collection, uri } = await build(connection);
    await targets.setKind("viya");

    const failing = handlers.runFile();
    await flush();
    const job = connection.currentJob();
    assert.ok(job, "the run should have created its job");
    for (const line of TRACEBACK_LINES) job.push(line);
    job.finish(false, "ZeroDivisionError: division by zero");
    await failing;

    const published = collection.get(uri) ?? [];
    assert.equal(published.length, 1);
    const diagnostic = published[0];
    assert.ok(diagnostic);
    assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(diagnostic.source, "Python on Viya");
    assert.equal(diagnostic.message, "ZeroDivisionError: division by zero");
    // innermost <string> frame is one-based line 2, whole-file offset 0.
    assert.equal(diagnostic.range.start.line, 1);
    assert.equal(
      diagnostic.relatedInformation?.length,
      2,
      "both <string> frames as related info",
    );

    // A second run clears the prior entry — `runNow` calls `clearFor` as soon
    // as it has a program, before this one even produces output.
    const passing = handlers.runFile();
    await flush();
    const job2 = connection.currentJob();
    assert.ok(job2);
    assert.notEqual(job2, job, "a fresh job for the second run");
    job2.push("done");
    job2.finish(true, undefined);
    await passing;

    assert.deepEqual([...(collection.get(uri) ?? [])], []);
  });

  it("publishes nothing for a SAS-side failure with no Python traceback", async () => {
    const connection = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const { handlers, targets, collection, uri } = await build(connection);
    await targets.setKind("viya");

    const failing = handlers.runFile();
    await flush();
    const job = connection.currentJob();
    assert.ok(job);
    // No traceback header — `parseTraceback` returns undefined and
    // `buildFailureOutcome` produces a message-only diagnostic, no
    // `application/vnd.python.traceback` output for `drainOutputs` to catch.
    job.push("ERROR: Some SAS-side failure.");
    job.finish(false, "ERROR: Some SAS-side failure.");
    await failing;

    assert.deepEqual([...(collection.get(uri) ?? [])], []);
  });

  describe("lifecycle clears (Phase 5d-iv)", () => {
    it("clears a file's entry when its document closes", async () => {
      const connection = createRecordedConnection({
        profileId: PROFILE_ID,
        profileName: PROFILE_NAME,
      });
      const { handlers, targets, collection, uri, document, closeEmitter } =
        await build(connection);
      await targets.setKind("viya");
      await publishOneFailure(connection, handlers);
      assert.equal((collection.get(uri) ?? []).length, 1);

      closeEmitter.fire(document);
      assert.deepEqual([...(collection.get(uri) ?? [])], []);
    });

    it("clears the whole collection on sign-out", async () => {
      const connection = createRecordedConnection({
        profileId: PROFILE_ID,
        profileName: PROFILE_NAME,
      });
      const { handlers, targets, collection, uri, signOutEmitter } =
        await build(connection);
      await targets.setKind("viya");
      await publishOneFailure(connection, handlers);
      assert.equal((collection.get(uri) ?? []).length, 1);

      signOutEmitter.fire();
      assert.deepEqual([...(collection.get(uri) ?? [])], []);
    });

    it("clears the whole collection when the run target flips to Local, but not on a viya→viya profile switch", async () => {
      const connection = createRecordedConnection({
        profileId: PROFILE_ID,
        profileName: PROFILE_NAME,
      });
      const { handlers, targets, collection, uri, profileChanges } =
        await build(connection);
      await targets.setKind("viya");
      await publishOneFailure(connection, handlers);
      assert.equal((collection.get(uri) ?? []).length, 1);

      // A profile switch while still parked on Viya fires the same
      // `onDidChange` — the entry stays.
      profileChanges.fire();
      assert.equal(
        (collection.get(uri) ?? []).length,
        1,
        "viya→viya switch leaves the entry alone",
      );

      await targets.setKind("local");
      assert.deepEqual([...(collection.get(uri) ?? [])], []);
    });
  });
});
