// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { sessionBindingKey } from "../../src/compute/binding";
import { SessionBindingStore } from "../../src/compute/bindingStore";

/**
 * The workspace's memory of its compute session.
 *
 * A unit suite rather than an integration one, which is worth a sentence because
 * its sibling `auth/sessionStore.ts` is the other way round. That store reaches
 * `SecretStorage`, which only exists on a real `ExtensionContext`; this one takes
 * two erased interfaces and a `Map` satisfies both, so the extension host would
 * be scaffolding around code that never asks it for anything. ADR-0009 draws the
 * line at a run-time `vscode` import for exactly this reason.
 *
 * What is worth testing is the recovery path. A stored value this did not write
 * — an older shape, a hand-edit, another extension's entry under a colliding key
 * — has to be discarded rather than half-read, and discarded *permanently*, so
 * that the next connect starts clean instead of parsing the same rubbish again.
 */

const PROFILE_ID = "9d1f3a2e-6c47-4b58-8a09-2f7e5c1d3b64";
const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const CONTEXT = "SAS Job Execution compute context";

/**
 * A `Memento` in a `Map`, with `keys()` on the side so a test can assert that
 * clearing left nothing behind rather than merely that reading returns nothing.
 *
 * `update(key, undefined)` deletes, which is the contract VS Code documents and
 * the reason `clear` is written the way it is.
 */
function memoryState(): {
  keys: () => string[];
  get: <T>(key: string, fallback?: T) => T | undefined;
  update: (key: string, value: unknown) => Promise<void>;
} {
  const entries = new Map<string, unknown>();

  return {
    keys: () => [...entries.keys()],
    get<T>(key: string, fallback?: T): T | undefined {
      const stored = entries.get(key);
      return stored === undefined ? fallback : (stored as T);
    },
    update(key: string, value: unknown): Promise<void> {
      if (value === undefined) entries.delete(key);
      else entries.set(key, value);
      return Promise.resolve();
    },
  };
}

function silentLog(): { debug: (message: string) => void; said: string[] } {
  const said: string[] = [];
  return { debug: (message: string) => said.push(message), said };
}

describe("session bindings", () => {
  let state: ReturnType<typeof memoryState>;
  let log: ReturnType<typeof silentLog>;
  let store: SessionBindingStore;

  beforeEach(() => {
    state = memoryState();
    log = silentLog();
    store = new SessionBindingStore(state, log);
  });

  it("round-trips a binding", async () => {
    await store.write(PROFILE_ID, { id: SESSION_ID, context: CONTEXT });

    assert.deepEqual(store.read(PROFILE_ID), {
      id: SESSION_ID,
      context: CONTEXT,
    });
  });

  it("has nothing to say about a profile it has never seen", () => {
    assert.equal(store.read("never-connected"), undefined);
  });

  it("stores under the profile's own key, as an opaque string", async () => {
    await store.write(PROFILE_ID, { id: SESSION_ID, context: CONTEXT });

    const key = sessionBindingKey(PROFILE_ID);
    assert.deepEqual(state.keys(), [key]);
    // A string, not a structured value: the codec is then the only thing that
    // has ever seen the shape, so a hand-edited `state.vscdb` cannot hand a
    // caller a half-typed record.
    assert.equal(typeof state.get(key), "string");
  });

  it("keeps one binding per profile", async () => {
    await store.write("profile-a", { id: "session-a", context: CONTEXT });
    await store.write("profile-b", { id: "session-b", context: CONTEXT });

    assert.equal(store.read("profile-a")?.id, "session-a");
    assert.equal(store.read("profile-b")?.id, "session-b");
  });

  it("replaces the binding when the session is replaced", async () => {
    await store.write(PROFILE_ID, { id: "old-session", context: CONTEXT });
    await store.write(PROFILE_ID, { id: SESSION_ID, context: CONTEXT });

    assert.equal(store.read(PROFILE_ID)?.id, SESSION_ID);
    assert.equal(state.keys().length, 1);
  });

  it("leaves no key behind when cleared", async () => {
    await store.write(PROFILE_ID, { id: SESSION_ID, context: CONTEXT });

    await store.clear(PROFILE_ID);

    assert.deepEqual(state.keys(), []);
    assert.equal(store.read(PROFILE_ID), undefined);
  });

  it("clears a profile that has no binding without complaint", async () => {
    await store.clear(PROFILE_ID);

    assert.deepEqual(state.keys(), []);
  });

  it("discards an entry it cannot read, and does not read it again", async () => {
    await state.update(sessionBindingKey(PROFILE_ID), "{not json");

    assert.equal(store.read(PROFILE_ID), undefined);
    // Self-healing rather than sticky: the next connect starts a session, and
    // an entry that cannot be parsed now will not start parsing later.
    assert.deepEqual(state.keys(), []);
  });

  it("discards a structured value another writer left behind", async () => {
    await state.update(sessionBindingKey(PROFILE_ID), {
      v: 1,
      id: SESSION_ID,
      context: CONTEXT,
    });

    assert.equal(store.read(PROFILE_ID), undefined);
    assert.deepEqual(state.keys(), []);
  });

  it("says so once, quietly, when it throws a binding away", async () => {
    await state.update(sessionBindingKey(PROFILE_ID), "{not json");

    store.read(PROFILE_ID);

    // `debug` rather than `warn`: losing a binding costs a fresh interpreter
    // and a few seconds, and giving that the weight of a failed request is how
    // an output channel stops being read.
    assert.equal(log.said.length, 1);
    assert.match(log.said[0] ?? "", /binding/);
  });
});
