// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `commands.ts`'s own 10b wiring — `syncStubsForFreshProbe`, and the
 * `reloadAdvisable` flag it threads through `ensureProbedEnvironment` into
 * both `showEnvironmentImpl` and `searchEnvironmentImpl` — exercised through
 * a real fresh probe, the same file-per-concern split
 * `commands-backend.test.ts`/`commands-diagnostics.test.ts` already draw
 * around `commands.test.ts`'s own "guards" suite.
 *
 * Adversarial review, `feat/phase-10b-pylance-stub-reflection`: this wiring
 * had a real injection seam (`RunCommandDeps.pylanceStubs`) built
 * specifically so a test could reach it without touching a real workspace's
 * filesystem or `settings.json`, but nothing used it — `commands.test.ts`'s
 * own cached-probe tests never reach `syncStubsForFreshProbe` at all (a
 * cache hit returns `reloadAdvisable: false` before ever calling it), and
 * `pylanceStubSync.ts`'s own integration suite calls `syncPylanceStubs`
 * directly, bypassing `commands.ts` entirely. Reaching a *fresh* probe needs
 * a real `backendFor()` → `new ProcPythonBackend(...)` construction (no
 * injectable factory) to succeed, which needs a `ComputeClient` scripted for
 * `probeRuntime()`'s own call sequence —
 * `test/helpers/recorded-probe-connection.ts` (new) is that fixture, trimmed
 * from `proc-python-backend.test.ts`'s own larger, private `router()`.
 *
 * `diff.kind` is always `"local-unknown"` in every case here — this
 * project's shared integration test host has no `ms-python.python`
 * installed (`environment-panel.test.ts`'s own comment notes the same
 * thing), so `readActiveLocalEnvironment()` can never resolve to `"known"`
 * here. That means `selectPackagesToStub`'s other branch (the `remoteOnly`
 * re-lookup, and its own "not found" `missing` log line) cannot be reached
 * through a live probe in this host either — it is fully covered instead at
 * `test/unit/stub-sync-plan.test.ts`, which needs no `vscode` and so needs
 * no live probe to test it. What these tests cover — which nothing else
 * did — is that `commands.ts` actually wires that pure decision logic
 * correctly: every remote package really does reach `deps.pylanceStubs`,
 * and each `PylanceStubSyncResult` outcome really does produce the log line,
 * the `inform()` call, and the `reloadAdvisable` flag `stubSyncPlan.ts` says
 * it should — including the exact regression the pre-push self-review fixed
 * (a `"synced"` outcome with `changed: false` must not repeat the reload
 * notice).
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { ENVIRONMENT_PROBE_FILENAME } from "../../../src/backend/environment";
import { createProfile } from "../../../src/profile/model";
import {
  createRunCommandHandlers,
  type RunCommandDeps,
  type RunCommandProfiles,
  type RunCommandSessions,
} from "../../../src/run/commands";
import { EnvironmentStore } from "../../../src/run/environmentStore";
import type { PylanceStubSyncResult } from "../../../src/run/pylanceStubSync";
import { RunOutputChannel } from "../../../src/run/outputChannel";
import type { StubbablePackage } from "../../../src/run/stubGenerator";
import {
  RunTargetStore,
  type RunTargetProfileSource,
} from "../../../src/run/targetStore";
import { memoryMemento, recordingLog } from "../../helpers/auth-host";
import { createRecordedProbeConnection } from "../../helpers/recorded-probe-connection";

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

/** A `RunCommandSessions` whose `connect()` always hands back the one
 * `ComputeConnection` given — every case in this file drives exactly one
 * fresh probe per test, so there is no reconnect/orphan behaviour worth
 * modelling (unlike `commands-backend.test.ts`'s own `recordedSessions`). */
function sessionsFromConnection(
  connection: ReturnType<typeof createRecordedProbeConnection>,
): RunCommandSessions {
  return {
    connect: () => Promise.resolve(connection),
    isBusy: () => false,
    startSubmission: () => true,
    endSubmission: () => {
      /* no-op */
    },
    forgetProfile: () => {
      /* not exercised by any case in this file */
    },
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

/** Records every package list `deps.pylanceStubs` was called with, and
 * answers every call with the same scripted `result` — every case in this
 * file scripts exactly one fresh probe, so one outcome per test is enough. */
function fakePylanceStubs(result: PylanceStubSyncResult): {
  readonly calls: (readonly StubbablePackage[])[];
  readonly pylanceStubs: RunCommandDeps["pylanceStubs"];
} {
  const calls: (readonly StubbablePackage[])[] = [];
  return {
    calls,
    pylanceStubs: (packages) => {
      calls.push(packages);
      return Promise.resolve(result);
    },
  };
}

describe("run commands — 10b Pylance stub sync wiring (fresh probe)", () => {
  let torndown: (() => void)[] = [];

  afterEach(() => {
    for (const dispose of torndown) dispose();
    torndown = [];
  });

  function build(deps: RunCommandDeps, log: vscode.LogOutputChannel) {
    const profiles = fakeProfiles();
    const targets = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles,
    );
    const environment = new EnvironmentStore({ globalState: memoryMemento() });
    const handlers = createRunCommandHandlers(
      sessionsFromConnection(
        createRecordedProbeConnection({
          profileId: PROFILE_ID,
          profileName: PROFILE_NAME,
          probeFileName: ENVIRONMENT_PROBE_FILENAME,
          payload: {
            version: "3.12.0",
            executable: "/usr/bin/python3",
            packages: [
              ["numpy", "2.0.0", ["numpy"]],
              ["pandas", "3.0.0", ["pandas"]],
            ],
          },
        }),
      ),
      profiles,
      targets,
      environment,
      log,
      vscode.Uri.file("/fake-extension"),
      {
        outputChannel: new RunOutputChannel({
          createChannel: () => fakeOutputChannel(),
        }),
        ...deps,
      },
    );
    torndown.push(() => {
      handlers.dispose();
      targets.dispose();
    });
    return { targets, handlers };
  }

  function fakeOutputChannel(): vscode.OutputChannel {
    return {
      name: "fake",
      append: () => {
        /* no-op */
      },
      appendLine: () => {
        /* no-op */
      },
      replace: () => {
        /* no-op */
      },
      clear: () => {
        /* no-op */
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
    };
  }

  it("stubs every remote package (local environment unknown here) and advises a reload when the sync changed the stub tree", async () => {
    const recorder = fakeRecorder();
    const { calls, pylanceStubs } = fakePylanceStubs({
      kind: "synced",
      changed: true,
    });
    const { channel } = recordingLog("10b wiring — changed:true");
    const { targets, handlers } = build(
      { ...recorder.deps, pylanceStubs },
      channel,
    );
    await targets.setKind("viya");

    await handlers.showEnvironment();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.map((pkg) => pkg.name).sort(), [
      "numpy",
      "pandas",
    ]);
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.scheme,
      "pythonOnViyaEnvironment",
    );
    assert.equal(recorder.informed.length, 1);
    assert.ok(/reload/i.test(recorder.informed[0] ?? ""));
  });

  it("does not advise a reload when the sync says nothing changed — the regression StubTreeSyncPlan.changed fixes", async () => {
    const recorder = fakeRecorder();
    const { pylanceStubs } = fakePylanceStubs({
      kind: "synced",
      changed: false,
    });
    const { channel } = recordingLog("10b wiring — changed:false");
    const { targets, handlers } = build(
      { ...recorder.deps, pylanceStubs },
      channel,
    );
    await targets.setKind("viya");

    await handlers.showEnvironment();

    // Before `StubTreeSyncPlan.changed` existed, every non-empty `"synced"`
    // outcome advised a reload regardless — this is the exact case that
    // would have (wrongly) nagged.
    assert.equal(recorder.informed.length, 0);
  });

  it("searchEnvironment shows the same reload notice a fresh probe's own sync produces", async () => {
    const recorder = fakeRecorder();
    const { pylanceStubs } = fakePylanceStubs({
      kind: "synced",
      changed: true,
    });
    const { channel } = recordingLog("10b wiring — search reload notice");
    const { targets, handlers } = build(
      {
        ...recorder.deps,
        pylanceStubs,
        // Cancels the picker immediately — this case is only about the
        // reload notice `searchEnvironmentImpl` shows before ever opening
        // it, not about picking a package.
        showQuickPick: () => Promise.resolve(undefined),
      },
      channel,
    );
    await targets.setKind("viya");

    await handlers.searchEnvironment();

    assert.equal(recorder.informed.length, 1);
    assert.ok(/reload/i.test(recorder.informed[0] ?? ""));
  });

  it("logs and informs a stub-path-conflict outcome from a fresh probe's sync, without advising a reload", async () => {
    const recorder = fakeRecorder();
    const { pylanceStubs } = fakePylanceStubs({
      kind: "stub-path-conflict",
      currentValue: "./my-own-stubs",
    });
    const { channel, lines } = recordingLog("10b wiring — conflict");
    const { targets, handlers } = build(
      { ...recorder.deps, pylanceStubs },
      channel,
    );
    await targets.setKind("viya");

    await handlers.showEnvironment();

    assert.equal(recorder.informed.length, 1);
    assert.ok((recorder.informed[0] ?? "").includes("./my-own-stubs"));
    assert.ok(
      !/reload/i.test(recorder.informed[0] ?? ""),
      "a stub-path conflict must not also claim a reload is worth it",
    );
    assert.ok(
      lines.some(
        (line) =>
          line.level === "warn" && line.message.includes("./my-own-stubs"),
      ),
      `expected a warn line naming the conflicting value; got: ${JSON.stringify(lines)}`,
    );
  });

  it("logs the caught error's own detail for a write-failed outcome, with no user-facing message", async () => {
    const recorder = fakeRecorder();
    const { pylanceStubs } = fakePylanceStubs({
      kind: "write-failed",
      detail: "EACCES: permission denied",
    });
    const { channel, lines } = recordingLog("10b wiring — write-failed");
    const { targets, handlers } = build(
      { ...recorder.deps, pylanceStubs },
      channel,
    );
    await targets.setKind("viya");

    await handlers.showEnvironment();

    assert.equal(recorder.informed.length, 0);
    assert.equal(recorder.reported.length, 0);
    assert.ok(
      lines.some(
        (line) =>
          line.level === "warn" &&
          line.message.includes("EACCES: permission denied"),
      ),
      `expected a warn line carrying the caught error's own detail; got: ${JSON.stringify(lines)}`,
    );
  });
});
