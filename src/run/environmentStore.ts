// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The persisted, per-profile cache of a stage-2 environment probe
 * (`ProcPythonBackend.probeRuntime()`'s successful answer).
 *
 * `globalState`, not `workspaceState` — same reasoning `profile/store.ts`
 * gives for its own `SECRETLESS_IDS_KEY`: a profile's interpreter version and
 * package set are facts about the *profile* (a deployment this user talks
 * to), not about the workspace open right now, and the same profile used from
 * two different folders should not probe twice. Keyed by profile id, not
 * name, for the same reason every other per-profile fact in this codebase is
 * (`profile/model.ts`'s `id` survives a rename; the name does not).
 *
 * **No automatic expiry.** `PRODUCTION_PLAN.md` §2.3 calls this "a slow
 * answer that changes rarely" and asks for an **explicit** refresh — see
 * `backend.ts`'s own corrected doc on `capabilities()`. A cached entry is
 * therefore valid until a user asks to refresh it, or until this store is
 * told the profile it belongs to no longer exists.
 */

import type * as vscode from "vscode";

import type { RuntimeCapabilities } from "../backend/backend";

const ENVIRONMENT_CACHE_KEY = "pythonOnViya.environmentCache";

/** One profile's cached probe, plus when it was taken — `Date.now()`, kept as
 * a plain number since this only ever needs to be displayed, never compared
 * across clock changes. */
export interface StoredEnvironment {
  readonly capabilities: RuntimeCapabilities;
  readonly probedAt: number;
}

/** The part of `ExtensionContext` this store actually uses — same narrowing
 * discipline as `ProfileStorageContext`/`RunTargetStorageContext`.
 *
 * Unlike those two, `vscode` is imported here **as a type only**: this store
 * holds no `EventEmitter`, touches no `vscode.workspace`, and implements no
 * `Disposable` — it is a plain `Map`-over-`Memento` class. So it stays in the
 * unit-tier coverage denominator (`.c8rc.json` does not exclude it) and its
 * tests live at `test/unit/`, not `test/integration/`. */
export type EnvironmentStorageContext = Pick<
  vscode.ExtensionContext,
  "globalState"
>;

export class EnvironmentStore {
  constructor(private readonly context: EnvironmentStorageContext) {}

  /** The last successful probe for a profile, or `undefined` if none has ever
   * been recorded (or it was cleared by {@link forget}). */
  get(profileId: string): StoredEnvironment | undefined {
    return this.readAll()[profileId];
  }

  /** Records a successful probe, replacing whatever this profile had before. */
  async set(
    profileId: string,
    capabilities: RuntimeCapabilities,
  ): Promise<void> {
    const all = this.readAll();
    await this.writeAll({
      ...all,
      [profileId]: { capabilities, probedAt: Date.now() },
    });
  }

  /** Drops a profile's cached probe — used when a profile is removed, so a
   * later profile that happens to reuse the id (it never does in practice;
   * `profile/model.ts` generates a fresh one per profile) never inherits a
   * stale answer. */
  async forget(profileId: string): Promise<void> {
    const all = this.readAll();
    if (!(profileId in all)) return;
    // Same rebuild-by-filter shape `profile/store.ts`'s own `remove()` uses
    // for its profile dictionary, rather than a destructured-and-discarded
    // binding.
    await this.writeAll(
      Object.fromEntries(
        Object.entries(all).filter(([id]) => id !== profileId),
      ),
    );
  }

  private readAll(): Record<string, StoredEnvironment> {
    return (
      this.context.globalState.get<Record<string, StoredEnvironment>>(
        ENVIRONMENT_CACHE_KEY,
      ) ?? {}
    );
  }

  private async writeAll(
    all: Record<string, StoredEnvironment>,
  ): Promise<void> {
    await this.context.globalState.update(
      ENVIRONMENT_CACHE_KEY,
      Object.keys(all).length === 0 ? undefined : all,
    );
  }
}
