// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { createProfile } from "../../../src/profile/model";
import {
  createRunCommandHandlers,
  type RunCommandDeps,
  type RunCommandProfiles,
  type RunCommandSessions,
} from "../../../src/run/commands";
import {
  RunTargetStore,
  type RunTargetProfileSource,
} from "../../../src/run/targetStore";
import { memoryMemento, testLogChannel } from "../../helpers/auth-host";

/**
 * The commands' own guard logic — everything a run, a cancel or a reset
 * refuses *before* it would need a real `ComputeConnection`. `ProcPythonBackend`
 * already has its own full unit suite (`proc-python-backend.test.ts`); what
 * this suite is for is the thin glue above it: does the right message appear
 * for the right refusal, and does `selectRunTarget` write what the user
 * picked to the right store. A live run's actual streaming is exercised at
 * `proc-python-backend.test.ts`'s and `richOutput`'s own tiers, not repeated
 * here against a second, hand-built fake transport.
 *
 * This suite calls `createRunCommandHandlers` directly rather than
 * `registerRunCommands` — command ids are global to the whole test host, and
 * the real extension's own activation (`onStartupFinished`) has already
 * claimed `pythonOnViya.runFile` and friends before this file's `describe`
 * body ever runs. A second `vscode.commands.registerCommand` for the same id
 * throws "command already exists" regardless of `afterEach` disposal, because
 * the conflict is with the real extension's registration, not with a previous
 * test in this file. `createRunCommandHandlers` is `commands.ts`'s seam for
 * exactly this: the same guard logic, callable with this suite's own fakes,
 * with no global registration at all.
 */

function sessionsThatMustNotConnect(): RunCommandSessions {
  return {
    connect(): Promise<never> {
      throw new Error("connect() should not have been called for this guard");
    },
    isBusy: () => false,
    startSubmission: () => true,
    endSubmission: () => {
      /* no-op */
    },
  };
}

function fakeProfiles(
  names: string[],
): RunCommandProfiles & RunTargetProfileSource {
  const profile = createProfile({
    id: "p1",
    endpoint: "https://viya.example.com",
  });
  let activeName: string | undefined = names[0];
  const emitter = new vscode.EventEmitter<void>();
  return {
    names: () => names,
    get: (name) => (names.includes(name) ? profile : undefined),
    setActiveName: (name) => {
      activeName = name;
      emitter.fire();
      return Promise.resolve();
    },
    active: () =>
      activeName === undefined ? undefined : { name: activeName, profile },
    onDidChange: emitter.event,
  };
}

function fakeRecorder(): {
  readonly reported: string[];
  readonly informed: string[];
  readonly deps: Pick<RunCommandDeps, "report" | "inform">;
} {
  const reported: string[] = [];
  const informed: string[] = [];
  return {
    reported,
    informed,
    deps: {
      report: (message) => reported.push(message),
      inform: (message) => informed.push(message),
    },
  };
}

describe("run commands — guards", () => {
  const log = testLogChannel("run commands");
  let torndown: (() => void)[] = [];

  afterEach(() => {
    for (const dispose of torndown) dispose();
    torndown = [];
  });

  function build(
    profiles: RunCommandProfiles & RunTargetProfileSource,
    deps: RunCommandDeps,
  ) {
    const targets = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles,
    );
    const handlers = createRunCommandHandlers(
      sessionsThatMustNotConnect(),
      profiles,
      targets,
      log,
      deps,
    );
    torndown.push(() => {
      handlers.dispose();
      targets.dispose();
    });
    return { targets, handlers };
  }

  it("refuses runFile when the target is Local, without connecting", async () => {
    const profiles = fakeProfiles([]);
    const recorder = fakeRecorder();
    const { targets, handlers } = build(profiles, { ...recorder.deps });
    await targets.setKind("local");

    await handlers.runFile();
    assert.equal(recorder.reported.length, 1);
    assert.ok((recorder.reported[0] ?? "").includes("Local Python"));
  });

  it("refuses runSelection when viya has no active profile, without connecting", async () => {
    const profiles = fakeProfiles([]);
    const recorder = fakeRecorder();
    const { handlers } = build(profiles, { ...recorder.deps });

    await handlers.runSelection();
    assert.equal(recorder.reported.length, 1);
    assert.ok(/profile/i.test(recorder.reported[0] ?? ""));
  });

  it("refuses resetPythonState the same way runFile does", async () => {
    const profiles = fakeProfiles([]);
    const recorder = fakeRecorder();
    const { targets, handlers } = build(profiles, { ...recorder.deps });
    await targets.setKind("local");

    await handlers.resetPythonState();
    assert.equal(recorder.reported.length, 1);
  });

  it("tells the user to open a Python file when there is no suitable editor", async () => {
    const profiles = fakeProfiles(["verde"]);
    const recorder = fakeRecorder();
    const { handlers } = build(profiles, {
      ...recorder.deps,
      activeTextEditor: () => undefined,
    });

    await handlers.runFile();
    assert.equal(recorder.informed.length, 1);
    assert.ok((recorder.informed[0] ?? "").includes("Python file"));
  });

  it("tells the user to select code when running an empty selection", async () => {
    const profiles = fakeProfiles(["verde"]);

    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content: "print(1)\n",
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 0);

    const recorder = fakeRecorder();
    const { handlers } = build(profiles, {
      ...recorder.deps,
      activeTextEditor: () => editor,
    });

    await handlers.runSelection();
    assert.equal(recorder.informed.length, 1);
    assert.ok(/select/i.test(recorder.informed[0] ?? ""));
  });

  it("reports nothing running when Cancel is invoked with no run in flight", async () => {
    const profiles = fakeProfiles([]);
    const recorder = fakeRecorder();
    const { handlers } = build(profiles, { ...recorder.deps });

    await handlers.cancelRun();
    assert.equal(recorder.informed.length, 1);
    assert.ok(/nothing/i.test(recorder.informed[0] ?? ""));
  });

  it("selectRunTarget: picking Local Python sets the target to local", async () => {
    const profiles = fakeProfiles(["verde"]);
    const { targets, handlers } = build(profiles, {
      showQuickPick: (items) =>
        Promise.resolve(
          items.find(
            (item) =>
              (item as { entry?: { kind?: string } }).entry?.kind === "local",
          ),
        ),
    });

    await handlers.selectRunTarget();
    assert.deepEqual(targets.status(), { kind: "local" });
  });

  it("selectRunTarget: picking a profile sets it active and the target to viya", async () => {
    const profiles = fakeProfiles(["verde", "prod"]);
    const { targets, handlers } = build(profiles, {
      showQuickPick: (items) =>
        Promise.resolve(
          items.find(
            (item) =>
              (item as { entry?: { profileName?: string } }).entry
                ?.profileName === "prod",
          ),
        ),
    });
    await targets.setKind("local");

    await handlers.selectRunTarget();
    assert.deepEqual(targets.status(), { kind: "viya", profileName: "prod" });
  });
});
