// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A `ComputeConnection`-shaped fixture over the same simulated wire
 * `recorded-proc-python.ts` builds — the "one layer up" `docs/phases/
 * phase-4.md`'s 4a slice asks for.
 *
 * `test/integration/run/commands.test.ts`'s own guard suite never reaches
 * `commands.ts`'s `backendFor()` at all (`sessionsThatMustNotConnect()` throws
 * the moment `connect()` is called), which is deliberate for that suite —
 * `PROC PYTHON`'s own contract already has a full unit suite, and the guard
 * suite is only the thin glue in front of it. What that leaves untested is
 * `backendFor()` itself: the reconnect-orphan `close()`, `cancelRun`'s
 * `currentReset` fallback, and the `backend.busy` serialisation guard in
 * `runNow`/`resetPythonState` all only exist *after* a real `ProcPythonBackend`
 * is running against a real (simulated) session — `phase-4.md`'s own Runbook
 * entry for 4a names all three. Closing that gap needs a `RunCommandSessions.
 * connect()` that resolves to a real `ComputeConnection`, so `backendFor()`'s
 * own `new ProcPythonBackend(...)` construction (`commands.ts:326` hardcodes
 * it — there is no injectable backend factory) runs against a simulated wire
 * rather than being bypassed.
 *
 * This module does not invent a second simulated wire. `SimulatedJob`,
 * `JobSlot`, `buildClient`, `session()` and `dialect()` are the same building
 * blocks `recorded-proc-python.ts` uses for its own `FakeBackend`-shaped
 * double — see that module's own doc comment ("What is exported for the
 * layer above this one") for the two additions it made for this file
 * specifically.
 */

import type { ComputeConnection } from "../../src/compute/sessionManager";
import type { DialectResolution } from "../../src/dialects/resolve";
import {
  buildClient,
  dialect,
  JobSlot,
  session,
  type SimulatedJob,
} from "./recorded-proc-python";

export interface RecordedConnectionOptions {
  readonly profileId: string;
  readonly profileName: string;
  /** Defaults to a fixed, fixture-only name — nothing in these tests reads
   * `ComputeConnection.context` back out, so a real compute context name
   * would only be decoration. */
  readonly context?: string;
  /** Forwarded to `buildClient` — see that function's own doc comment.
   * Defaults to `true`, matching `recorded-proc-python.ts`'s own default;
   * a test driving `resetPythonState()`'s timing by hand passes `false`. */
  readonly autoFinishReset?: boolean;
}

/** One recorded connection, and the one thing a test needs back out of it
 * that {@link ComputeConnection} itself does not expose: which simulated job,
 * if any, the backend built from it has created. */
export interface RecordedConnection {
  readonly connection: ComputeConnection;
  /** `undefined` until an `execute()` or `reset()` call through this
   * connection's client has actually created one — see `JobSlot.current()`. */
  currentJob(): SimulatedJob | undefined;
}

/**
 * Builds a fresh `ComputeConnection`, backed by its own simulated wire and
 * its own `JobSlot` — two connections built by two separate calls share
 * nothing, which is exactly what a reconnect test needs: `backendFor()`'s
 * orphan-close path only exercises for real when the *new* connection is a
 * distinct object from the one a cached backend was built from
 * (`sessionManager.ts`'s own `ComputeConnection` is never reused across a
 * reattach for that reason, and this fixture mirrors it rather than reusing
 * one instance for convenience).
 */
export function createRecordedConnection(
  options: RecordedConnectionOptions,
): RecordedConnection {
  const slot = new JobSlot();
  // Conditional spread, not `autoFinishReset: options.autoFinishReset` —
  // `exactOptionalPropertyTypes` treats an explicit `undefined` as different
  // from an absent key, and `buildClient`'s own options type wants the key
  // absent so its `?? true` default actually applies, the same reason
  // `commands.ts`'s `selectRunTarget` builds its picker items this way.
  const client = buildClient(slot, {
    ...(options.autoFinishReset === undefined
      ? {}
      : { autoFinishReset: options.autoFinishReset }),
  });
  const generation: DialectResolution = {
    dialect: dialect(),
    reason: "recorded-connection fixture",
    certain: true,
  };

  const connection: ComputeConnection = {
    profileId: options.profileId,
    profileName: options.profileName,
    context: options.context ?? "recorded-connection-context",
    client,
    generation,
    session: session(),
  };

  return {
    connection,
    currentJob: () => slot.current(),
  };
}
