// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { createProfile } from "../../../src/profile/model";
import {
  RunTargetStore,
  type RunTargetProfileSource,
} from "../../../src/run/targetStore";
import { memoryMemento } from "../../helpers/auth-host";

/** A minimal double for the one thing this store needs from `ProfileStore`. */
function fakeProfiles(initialActiveName: string | undefined): {
  readonly source: RunTargetProfileSource;
  setActive(name: string | undefined): void;
} {
  const emitter = new vscode.EventEmitter<void>();
  let activeName = initialActiveName;
  const profile = createProfile({
    id: "p1",
    endpoint: "https://viya.example.com",
  });

  return {
    source: {
      active: () =>
        activeName === undefined ? undefined : { name: activeName, profile },
      onDidChange: emitter.event,
    },
    setActive(name) {
      activeName = name;
      emitter.fire();
    },
  };
}

describe("RunTargetStore", () => {
  it("defaults to local with nothing stored, per ADR-0020, even with an active profile", () => {
    const profiles = fakeProfiles("verde");
    const store = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles.source,
    );
    assert.deepEqual(store.status(), { kind: "local" });
    assert.deepEqual(store.readiness(), { ok: false, reason: "local" });
    store.dispose();
  });

  it("resolves viya against the active profile once the target is explicitly set to viya", async () => {
    const profiles = fakeProfiles("verde");
    const store = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles.source,
    );

    await store.setKind("viya");
    assert.deepEqual(store.status(), { kind: "viya", profileName: "verde" });
    assert.deepEqual(store.readiness(), { ok: true, profileName: "verde" });
    store.dispose();
  });

  it("resolves to no-profile when the target is viya but nothing is active", async () => {
    const profiles = fakeProfiles(undefined);
    const store = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles.source,
    );

    await store.setKind("viya");
    assert.deepEqual(store.status(), { kind: "viya" });
    assert.deepEqual(store.readiness(), { ok: false, reason: "no-profile" });
    store.dispose();
  });

  it("persists a change to Viya across a fresh store over the same memento", () => {
    const workspaceState = memoryMemento();
    const profiles = fakeProfiles("verde");
    const first = new RunTargetStore({ workspaceState }, profiles.source);

    return first.setKind("viya").then(() => {
      first.dispose();
      const second = new RunTargetStore({ workspaceState }, profiles.source);
      assert.deepEqual(second.status(), {
        kind: "viya",
        profileName: "verde",
      });
      assert.deepEqual(second.readiness(), { ok: true, profileName: "verde" });
      second.dispose();
    });
  });

  it("fires onDidChange when the active profile changes without touching the target", async () => {
    const profiles = fakeProfiles(undefined);
    const store = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles.source,
    );
    // The target has to be at viya for a profile change to show up in
    // `status()` at all — a change while the target is Local fires the same
    // event, but `status()` never carries a `profileName` for Local.
    await store.setKind("viya");

    let fired = 0;
    const subscription = store.onDidChange(() => {
      fired += 1;
    });

    profiles.setActive("prod");
    assert.equal(fired, 1);
    assert.deepEqual(store.status(), { kind: "viya", profileName: "prod" });

    subscription.dispose();
    store.dispose();
  });

  it("fires onDidChange when the target is set", async () => {
    const profiles = fakeProfiles("verde");
    const store = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles.source,
    );

    let fired = 0;
    const subscription = store.onDidChange(() => {
      fired += 1;
    });

    await store.setKind("viya");
    assert.equal(fired, 1);

    subscription.dispose();
    store.dispose();
  });
});
