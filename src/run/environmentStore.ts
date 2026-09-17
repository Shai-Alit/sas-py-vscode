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

/**
 * Whether a persisted entry still matches the shape this build reads back.
 *
 * `globalState` is a JSON store with no schema version, and `Memento.get<T>()`
 * casts whatever is in it to `T` without checking anything. That was harmless
 * while {@link StoredEnvironment} only ever gained *optional* fields — but 10b
 * made `PythonPackage.importNames` **required** (`backend.ts`'s own doc
 * comment on it; `docs/phases/phase-10.md`'s Plan section), so every entry
 * written by an earlier build is now a typed lie the moment this one reads it:
 * `packages[i].importNames` is declared `readonly string[]` and is actually
 * `undefined`, and `stubSyncPlan.ts`'s `shadowsLocalPackage` iterates it
 * directly.
 *
 * Nothing on today's cache-hit path reaches that iteration — `commands.ts`
 * syncs stubs only after a *fresh* probe — so this guards the seam rather than
 * fixing a live crash. Dropping the entry, rather than patching a default
 * into it, is deliberate: the real `importNames` are not derivable from what
 * was stored, and the cost of dropping one is a single silent re-probe, which
 * is exactly what a user upgrading into a feature that needs new probe data
 * should get. The drop is durable as well as per-read — `set`/`forget` both
 * rebuild from this method, so the stale entry stops being persisted the next
 * time either runs.
 *
 * Takes `unknown`, not `StoredEnvironment | undefined`: that declared type is
 * exactly the claim in doubt here, and accepting it would make every check
 * below redundant *to the type checker* while remaining necessary at runtime —
 * `@typescript-eslint/no-unnecessary-condition` says so out loud on the `null`
 * guard. `unknown` is the honest parameter type for a value read back out of
 * a schema-less JSON store.
 */
function isCurrentShape(stored: unknown): boolean {
  if (typeof stored !== "object" || stored === null) return false;
  const capabilities = (stored as Record<string, unknown>).capabilities;
  if (typeof capabilities !== "object" || capabilities === null) return false;
  // Same `as`-to-an-unknown-valued-record idiom `environment.ts`'s own
  // `readPackages` uses to walk an unvalidated wire payload — never a cast to
  // the destination type itself, which would assert exactly what is in doubt.
  const fields = capabilities as Record<string, unknown>;
  // `"unprobed"` carries no packages, so there is nothing here it can fail.
  if (fields.kind !== "available") return true;
  return (
    Array.isArray(fields.packages) &&
    fields.packages.every((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return false;
      const pkg = entry as Record<string, unknown>;
      return (
        typeof pkg.name === "string" &&
        typeof pkg.version === "string" &&
        Array.isArray(pkg.importNames) &&
        pkg.importNames.every((name: unknown) => typeof name === "string")
      );
    })
  );
}

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
    const all =
      this.context.globalState.get<Record<string, StoredEnvironment>>(
        ENVIRONMENT_CACHE_KEY,
      ) ?? {};
    return Object.fromEntries(
      Object.entries(all).filter(([, stored]) => isCurrentShape(stored)),
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
