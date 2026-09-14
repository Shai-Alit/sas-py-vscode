// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The one-backend-per-profile cache `commands.ts` built for itself in 3d-i,
 * lifted out to its own module in Phase 9's 9b slice so a `NotebookController`
 * can share it rather than duplicate it.
 *
 * `docs/phases/phase-9.md`'s own scoping ("What needs real design work, not a
 * port") named this refactor as a prerequisite for the notebook controller:
 * `backends`/`backendFor` used to live as private closures inside
 * `createRunCommandHandlers`, reachable only by Run File/Run Selection/Reset/
 * Show Environment — nothing outside that function could reach the same
 * backend instance for a given profile. A notebook controller built alongside
 * it without this move would either stand up a second, independent backend
 * for the same profile (two interpreters' worth of state for one profile,
 * defeating the "a notebook cell and Run File share state" goal
 * `PRODUCTION_PLAN.md` promises) or reach into `commands.ts`'s closure, which
 * nothing outside that module can do.
 *
 * Every clause below — the idempotent-reconnect fast path, the orphan-close
 * on a reattach, why there is no injectable backend factory — is unchanged
 * from `commands.ts`'s own pre-9b version; this module is a move, not a
 * rewrite. See `commands-backend.test.ts`'s own doc comment for why that
 * still matters for testing: there is still no injectable backend factory, so
 * a test exercising the reconnect-orphan path still has to run a real
 * `ProcPythonBackend` over a simulated wire (`test/helpers/
 * recorded-connection.ts`), not a fake standing in for this cache.
 *
 * `createRunCommandHandlers` defaults to building its own `BackendCache` via
 * {@link createBackendCache} when nothing is injected — same "defaults to the
 * real thing, injectable for sharing or testing" shape `RunCommandDeps`'s
 * other fields already use. `notebookController.ts`'s own
 * `createNotebookExecutionHandlers` takes a `BackendCache` as a required
 * parameter instead, since it has no other caller that would ever want a
 * private one of its own. Either way, `extension.ts` is the one place that
 * matters in production: it builds exactly one instance and hands it to
 * both, so a notebook cell and a Run File invocation against the same
 * profile reuse one connected backend rather than each holding an
 * independent one.
 */

import type * as vscode from "vscode";

import { ProcPythonBackend, type SubmissionGuard } from "../backend/procPython";
import type {
  ComputeConnection,
  ComputeSessionManager,
} from "../compute/sessionManager";

/** What this cache needs from `ComputeSessionManager`: connecting the active
 * profile, and the per-profile submission guard `procPython.ts`'s
 * `SubmissionGuard` is a narrowed port onto. Structurally identical to
 * `commands.ts`'s own `RunCommandSessions` minus `forgetProfile` — every
 * caller of {@link createBackendCache} today (`commands.ts`,
 * `notebookController.ts`) already holds an object satisfying the wider
 * type, so there is nothing to narrow at either call site. */
export type BackendCacheSessions = Pick<
  ComputeSessionManager,
  "connect" | "isBusy" | "startSubmission" | "endSubmission"
>;

/** One backend per profile, held for as long as the connection it was built
 * from is still the live one. */
export interface CachedBackend {
  readonly connection: ComputeConnection;
  readonly backend: ProcPythonBackend;
}

/**
 * Connects the active profile and hands back its backend, reusing one
 * already built from the same `ComputeConnection` across every caller that
 * shares this cache instance.
 */
export interface BackendCache extends vscode.Disposable {
  /**
   * `undefined` means `sessions.connect()` already reported why — a dead
   * token, an untrusted folder, no profile — and there is nothing further for
   * a caller to say.
   */
  backendFor(): Promise<CachedBackend | undefined>;
}

export function createBackendCache(
  sessions: BackendCacheSessions,
  log: vscode.LogOutputChannel,
): BackendCache {
  const backends = new Map<string, CachedBackend>();

  const guardFor = (profileId: string): SubmissionGuard => ({
    isBusy: () => sessions.isBusy(profileId),
    startSubmission: () => sessions.startSubmission(profileId),
    endSubmission: () => {
      sessions.endSubmission(profileId);
    },
  });

  const backendFor = async (): Promise<CachedBackend | undefined> => {
    const connection = await sessions.connect();
    if (connection === undefined) return undefined;

    const cached = backends.get(connection.profileId);
    if (cached?.connection === connection) {
      // Idempotent and I/O-free (`ExecutionBackend.connect()`'s own
      // contract) — always re-marking a cached backend connected is what
      // makes it safe to hand back one a caller closed underneath a `reset()`
      // (or, since 9b, underneath a notebook cell run): closing sets
      // `connected = false` and there is no other hook that would otherwise
      // notice and reconnect it.
      await cached.backend.connect();
      return cached;
    }

    if (cached?.backend.busy) {
      // A reconnect landed while the old backend still had a run or a reset
      // in flight (a new `ComputeConnection` for the same profile — a
      // reattach, a new dialect resolution). Overwriting the cache entry
      // below would otherwise orphan it: every caller's own cancel/interrupt
      // path only ever looks at what `backends` holds *now*, so the old
      // backend would keep running with nothing left able to reach it.
      // Closing it here is the same "cancel whatever is in flight, then
      // disconnect" `close()` already does for every other caller of it.
      await cached.backend.close();
    }

    const backend = new ProcPythonBackend(
      connection.client,
      connection.session,
      connection.generation.dialect,
      guardFor(connection.profileId),
      (reason) => {
        log.warn(reason);
      },
    );
    // Never performs I/O (ExecutionBackend's own contract) — this only marks
    // the backend ready to accept `execute()`/`reset()` calls.
    await backend.connect();

    const entry: CachedBackend = { connection, backend };
    backends.set(connection.profileId, entry);
    return entry;
  };

  return {
    backendFor,
    // Unlike `ComputeSessionManager.dispose()` — which has nothing worth
    // tearing down server-side, and says so — a busy `ProcPythonBackend` has
    // a real interrupt `close()` can send. Fired, not awaited: this method is
    // synchronous, the window is closing regardless, and there is nowhere to
    // await it that VS Code would honour, the same reasoning
    // `ComputeSessionManager.dispose()` gives for not joining an in-flight
    // `connect()`. If the interrupt never lands before the process exits, the
    // SAS-side run keeps executing to its own conclusion, unwatched rather
    // than orphaned — this window has simply stopped being the one that
    // cares. Safe to call on every cached backend regardless of whether it is
    // actually busy: past the cancel branch, `close()`'s own contract is a
    // no-op.
    dispose: () => {
      for (const cached of backends.values()) {
        void cached.backend.close();
      }
    },
  };
}
