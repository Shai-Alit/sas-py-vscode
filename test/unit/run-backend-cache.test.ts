// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `createBackendCache`'s own reconnect/busy logic — moved out of
 * `commands.ts` in Phase 9's 9b slice (`../../src/run/backendCache.ts`'s own
 * doc comment), and now reachable directly by the unit tier: unlike
 * `commands.ts` itself, this module imports `vscode` only for types
 * (`LogOutputChannel`, `Disposable`), so nothing here actually needs a real
 * `vscode` module at runtime — `check-coverage-scope.mjs`'s own rule is
 * "excluded if and only if the unit tier cannot reach it", and the unit tier
 * can reach this one.
 *
 * `test/integration/run/commands-backend.test.ts` already exercises this
 * exact logic end to end, through `commands.ts`'s own default cache — that
 * suite's own doc comment explains why a real `ProcPythonBackend` over a
 * simulated wire is the only way to reach these paths (no injectable backend
 * factory). This suite reuses the identical fixture
 * (`test/helpers/recorded-connection.ts`) at the unit tier instead, so the
 * same reconnect/busy/dispose behaviour counts toward unit coverage rather
 * than only ever being proven by the integration tier.
 */

import assert from "node:assert/strict";

import type { LogOutputChannel, Uri } from "vscode";

import type { Program } from "../../src/backend/backend";
import {
  createBackendCache,
  type BackendCache,
  type BackendCacheSessions,
} from "../../src/run/backendCache";
import {
  createRecordedConnection,
  type RecordedConnection,
} from "../helpers/recorded-connection";

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const PROFILE_ID = "p1";
const PROFILE_NAME = "verde";

/** Same shape `commands-backend.test.ts`'s own `recordedSessions()` uses. */
function recordedSessions(
  initial: RecordedConnection,
): BackendCacheSessions & { setConnection(next: RecordedConnection): void } {
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

/** `warn` is the only member `createBackendCache` ever calls. */
function fakeLog(): LogOutputChannel {
  return {
    warn: () => {
      /* no-op */
    },
  } as unknown as LogOutputChannel;
}

function program(): Program {
  return {
    bytes: new TextEncoder().encode("print(1)\n"),
    origin: {
      // Same fixture-only fake `test/helpers/fake-backend.ts` uses for a
      // `Program.origin.uri` — no real `vscode.Uri` needed to satisfy the
      // two fields `backend.ts` actually declares.
      uri: { scheme: "file", path: "/workspace/program.py" } as unknown as Uri,
      lineOffset: 0,
    },
  };
}

describe("run/backendCache", () => {
  const log = fakeLog();

  function cache(sessions: BackendCacheSessions): BackendCache {
    return createBackendCache(sessions, log);
  }

  it("connects and constructs a backend on the first call", async () => {
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const backendCache = cache(sessions);

    const built = await backendCache.backendFor();
    assert.ok(built);
    assert.equal(built.connection, recorded.connection);
    assert.equal(built.backend.busy, false);
  });

  it("reuses the cached backend for a second call against the same connection", async () => {
    const recorded = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(recorded);
    const backendCache = cache(sessions);

    const first = await backendCache.backendFor();
    const second = await backendCache.backendFor();
    assert.ok(first);
    assert.ok(second);
    assert.equal(
      first.backend,
      second.backend,
      "the same ComputeConnection object should reuse one backend instance, not build a second",
    );
  });

  it("returns undefined when sessions.connect() finds no active profile", async () => {
    const sessions: BackendCacheSessions = {
      connect: () => Promise.resolve(undefined),
      isBusy: () => false,
      startSubmission: () => true,
      endSubmission: () => {
        /* no-op */
      },
    };
    const backendCache = cache(sessions);

    assert.equal(await backendCache.backendFor(), undefined);
  });

  it("builds a fresh backend for a reconnect that is not busy, without closing the old one", async () => {
    const first = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const second = createRecordedConnection({
      profileId: PROFILE_ID,
      profileName: PROFILE_NAME,
    });
    const sessions = recordedSessions(first);
    const backendCache = cache(sessions);

    const before = await backendCache.backendFor();
    assert.ok(before);

    sessions.setConnection(second);
    const after = await backendCache.backendFor();
    assert.ok(after);
    assert.notEqual(
      before.backend,
      after.backend,
      "a new ComputeConnection for the same profile should get its own fresh backend",
    );
    assert.equal(
      before.backend.busy,
      false,
      "the idle old backend should be left alone, not closed out from under nothing",
    );
  });

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
    const backendCache = cache(sessions);

    const before = await backendCache.backendFor();
    assert.ok(before);
    // `execute()` marks the backend busy synchronously (`this.active = run`),
    // before the returned promise even settles — no need to wait for a job
    // to actually bind on the simulated wire for `busy` to already be true.
    void before.backend.execute(program(), { freshNamespace: false });
    assert.equal(before.backend.busy, true);

    sessions.setConnection(second);
    const after = await backendCache.backendFor();
    assert.ok(after);
    assert.notEqual(before.backend, after.backend);

    // `backendFor()` itself `await`s `close()` before returning, but
    // `close()`'s own cancellation only *starts* unwinding `execute()`'s
    // still-pending `runProgram()` call (via an aborted signal) — the
    // `.finally()` that actually clears `this.active` runs on that call's own
    // timeline, not `close()`'s, so this needs the same flush `dispose()`'s
    // own test below does.
    await flush();
    assert.equal(
      before.backend.busy,
      false,
      "the reconnect should have closed the orphaned backend, cancelling its run",
    );
  });

  it("dispose() closes every cached backend, across every profile it ever built one for", async () => {
    const a = createRecordedConnection({
      profileId: "p-a",
      profileName: "a",
    });
    const b = createRecordedConnection({
      profileId: "p-b",
      profileName: "b",
    });
    const sessions = recordedSessions(a);
    const backendCache = cache(sessions);

    const builtA = await backendCache.backendFor();
    assert.ok(builtA);
    void builtA.backend.execute(program(), { freshNamespace: false });
    assert.equal(builtA.backend.busy, true);

    sessions.setConnection(b);
    const builtB = await backendCache.backendFor();
    assert.ok(builtB);
    void builtB.backend.execute(program(), { freshNamespace: false });
    assert.equal(builtB.backend.busy, true);

    backendCache.dispose();
    // `dispose()`'s own `close()` calls are fired, not awaited (its own doc
    // comment explains why) — flush lets both cancellations actually settle
    // before this test reads `busy` back out.
    await flush();
    await flush();

    assert.equal(builtA.backend.busy, false);
    assert.equal(builtB.backend.busy, false);
  });
});
