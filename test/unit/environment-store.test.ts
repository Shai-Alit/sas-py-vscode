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
  packages: [{ name: "numpy", version: "2.0.0", importNames: ["numpy"] }],
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

  /**
   * `globalState` has no schema version, so an entry an older build wrote is
   * still there verbatim after an upgrade and `Memento.get<T>()` hands it back
   * cast to `T` unchecked. 10b made `PythonPackage.importNames` required,
   * which turned every pre-10b entry into a typed lie — see
   * `environmentStore.ts`'s own `isCurrentShape` doc comment.
   *
   * These write the raw cache object straight into the memento rather than
   * going through `set()`, because `set()` can only ever produce the *current*
   * shape; the whole point is what a previous release left behind.
   */
  describe("entries written by an older build", () => {
    /** `environmentStore.ts`'s own `ENVIRONMENT_CACHE_KEY`, restated — it is
     * module-private there, and pinning it here is worth doing on its own: the
     * key is a persistence contract, so changing it silently orphans every
     * user's cache. */
    const CACHE_KEY = "pythonOnViya.environmentCache";

    const seed = (
      globalState: EnvironmentStorageContext["globalState"],
      entry: unknown,
    ): void => {
      void globalState.update(CACHE_KEY, { "profile-1": entry });
    };

    it("drops a pre-10b entry whose packages have no importNames, so the profile re-probes", () => {
      const globalState = memoryMemento();
      seed(globalState, {
        probedAt: 1,
        capabilities: {
          kind: "available",
          version: "3.12.12",
          executable: "/usr/bin/python3",
          // Exactly what a pre-10b build wrote: `[name, version]` only.
          packages: [{ name: "numpy", version: "2.0.0" }],
        },
      });

      const store = new EnvironmentStore({ globalState });
      assert.equal(store.get("profile-1"), undefined);
    });

    it("drops an entry whose packages are not a list at all", () => {
      const globalState = memoryMemento();
      seed(globalState, {
        probedAt: 1,
        capabilities: {
          kind: "available",
          version: "3.12.12",
          executable: "/usr/bin/python3",
          packages: "not-a-list",
        },
      });

      assert.equal(
        new EnvironmentStore({ globalState }).get("profile-1"),
        undefined,
      );
    });

    it("drops an entry whose importNames is present but not a list of strings", () => {
      const globalState = memoryMemento();
      seed(globalState, {
        probedAt: 1,
        capabilities: {
          kind: "available",
          version: "3.12.12",
          executable: "/usr/bin/python3",
          packages: [{ name: "numpy", version: "2.0.0", importNames: [7] }],
        },
      });

      assert.equal(
        new EnvironmentStore({ globalState }).get("profile-1"),
        undefined,
      );
    });

    it("drops an entry that is not an object at all", () => {
      // Not only an older *build* — `globalState` is a JSON file on disk, and
      // a truncated or hand-edited one deserializes to whatever it happens to
      // contain. Both primitive and `null` are checked, since `typeof null`
      // is `"object"` and only the explicit comparison catches it.
      for (const junk of ["garbage", 7, null]) {
        const globalState = memoryMemento();
        seed(globalState, junk);
        assert.equal(
          new EnvironmentStore({ globalState }).get("profile-1"),
          undefined,
        );
      }
    });

    it("drops an entry whose capabilities field is missing or not an object", () => {
      for (const junk of [undefined, "available", null]) {
        const globalState = memoryMemento();
        seed(globalState, { probedAt: 1, capabilities: junk });
        assert.equal(
          new EnvironmentStore({ globalState }).get("profile-1"),
          undefined,
        );
      }
    });

    it("drops an entry whose packages list holds something that is not a package", () => {
      for (const junk of ["numpy", null]) {
        const globalState = memoryMemento();
        seed(globalState, {
          probedAt: 1,
          capabilities: {
            kind: "available",
            version: "3.12.12",
            executable: "/usr/bin/python3",
            packages: [junk],
          },
        });
        assert.equal(
          new EnvironmentStore({ globalState }).get("profile-1"),
          undefined,
        );
      }
    });

    it("keeps an unprobed entry, which has no packages to be wrong about", () => {
      const globalState = memoryMemento();
      seed(globalState, { probedAt: 1, capabilities: { kind: "unprobed" } });

      assert.deepEqual(
        new EnvironmentStore({ globalState }).get("profile-1")?.capabilities,
        { kind: "unprobed" },
      );
    });

    it("keeps a current-shape entry alongside a stale one, and stops persisting the stale one", async () => {
      const globalState = memoryMemento();
      void globalState.update(CACHE_KEY, {
        stale: {
          probedAt: 1,
          capabilities: {
            kind: "available",
            version: "3.11.0",
            executable: "/usr/bin/python3.11",
            packages: [{ name: "numpy", version: "2.0.0" }],
          },
        },
        current: { probedAt: 2, capabilities: available },
      });

      const store = new EnvironmentStore({ globalState });
      assert.equal(store.get("stale"), undefined);
      assert.deepEqual(store.get("current")?.capabilities, available);

      // The drop is durable, not just per-read: any write rebuilds the
      // dictionary from the filtered view, so the stale entry stops occupying
      // the memento rather than being re-filtered forever.
      await store.set("profile-2", available);
      assert.deepEqual(
        Object.keys(
          globalState.get<Record<string, unknown>>(CACHE_KEY) ?? {},
        ).sort(),
        ["current", "profile-2"],
      );
    });
  });
});
