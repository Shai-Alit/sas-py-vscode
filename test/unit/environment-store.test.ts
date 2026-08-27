// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { type RuntimeCapabilities } from "../../src/backend/backend";
import {
  EnvironmentStore,
  type EnvironmentStorageContext,
} from "../../src/run/environmentStore";

/**
 * A unit suite, not an integration one, for the same reason
 * `compute-binding-store.test.ts` is: `EnvironmentStore` holds no
 * `EventEmitter`, touches no `vscode.workspace`, and implements no
 * `Disposable` — it takes a `Memento` and a `Map` satisfies that. `vscode` is
 * a type-only import in the module, so it stays in the unit-tier coverage
 * denominator (ADR-0009), and the extension host would only be scaffolding
 * around code that never asks it for anything.
 */

/**
 * A `globalState` in a `Map`, with `keys()` kept public so a test can assert
 * that clearing left the memento empty rather than merely that a read returns
 * nothing — the branch in `writeAll` that stores `undefined` once the last
 * entry is forgotten.
 *
 * `update(key, undefined)` deletes, which is the contract VS Code documents.
 */
function memoryMemento(): EnvironmentStorageContext["globalState"] {
  const entries = new Map<string, unknown>();

  return {
    keys: () => [...entries.keys()],
    get<T>(key: string, fallback?: T): T | undefined {
      const stored = entries.get(key);
      return stored === undefined ? fallback : (stored as T);
    },
    update(key: string, value: unknown): Thenable<void> {
      if (value === undefined) entries.delete(key);
      else entries.set(key, value);
      return Promise.resolve();
    },
    setKeysForSync(): void {
      // Nothing in a unit run syncs anywhere.
    },
  };
}

const available: RuntimeCapabilities = {
  kind: "available",
  version: "3.12.12",
  executable: "/usr/bin/python3",
  packages: [{ name: "numpy", version: "2.0.0" }],
};

describe("EnvironmentStore", () => {
  it("has nothing cached for a profile that was never probed", () => {
    const store = new EnvironmentStore({ globalState: memoryMemento() });
    assert.equal(store.get("profile-1"), undefined);
  });

  it("remembers a successful probe, with a probedAt timestamp", async () => {
    const store = new EnvironmentStore({ globalState: memoryMemento() });
    const before = Date.now();
    await store.set("profile-1", available);
    const after = Date.now();

    const stored = store.get("profile-1");
    assert.ok(stored !== undefined);
    assert.deepEqual(stored.capabilities, available);
    assert.ok(stored.probedAt >= before && stored.probedAt <= after);
  });

  it("keeps two profiles' caches independent", async () => {
    const store = new EnvironmentStore({ globalState: memoryMemento() });
    const other: RuntimeCapabilities = {
      kind: "available",
      version: "3.11.0",
      executable: "/usr/bin/python3.11",
      packages: [],
    };
    await store.set("profile-1", available);
    await store.set("profile-2", other);

    assert.deepEqual(store.get("profile-1")?.capabilities, available);
    assert.deepEqual(store.get("profile-2")?.capabilities, other);
  });

  it("replaces a profile's cache on a later set()", async () => {
    const store = new EnvironmentStore({ globalState: memoryMemento() });
    await store.set("profile-1", available);
    const refreshed: RuntimeCapabilities = {
      kind: "available",
      version: "3.13.0",
      executable: "/usr/bin/python3",
      packages: [],
    };
    await store.set("profile-1", refreshed);

    assert.deepEqual(store.get("profile-1")?.capabilities, refreshed);
  });

  it("forgets a profile, leaving others untouched", async () => {
    const store = new EnvironmentStore({ globalState: memoryMemento() });
    await store.set("profile-1", available);
    await store.set("profile-2", available);

    await store.forget("profile-1");

    assert.equal(store.get("profile-1"), undefined);
    assert.ok(store.get("profile-2") !== undefined);
  });

  it("forgetting a profile with nothing cached is a harmless no-op", async () => {
    const store = new EnvironmentStore({ globalState: memoryMemento() });
    await store.forget("no-such-profile");
    assert.equal(store.get("no-such-profile"), undefined);
  });

  it("leaves the memento empty once the last profile is forgotten", async () => {
    const globalState = memoryMemento();
    const store = new EnvironmentStore({ globalState });
    await store.set("profile-1", available);
    await store.forget("profile-1");

    // Not just "get returns undefined" — the key itself is gone, so a later
    // reader sees no half-written cache object at all.
    assert.deepEqual(globalState.keys(), []);
  });

  it("persists across a fresh store instance over the same memento", async () => {
    const globalState = memoryMemento();
    const first = new EnvironmentStore({ globalState });
    await first.set("profile-1", available);

    const second = new EnvironmentStore({ globalState });
    assert.deepEqual(second.get("profile-1")?.capabilities, available);
  });
});
