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
  it("defaults to viya with no active profile", () => {
    const profiles = fakeProfiles(undefined);
    const store = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles.source,
    );
    assert.deepEqual(store.status(), { kind: "viya" });
    assert.deepEqual(store.readiness(), { ok: false, reason: "no-profile" });
    store.dispose();
  });

  it("resolves viya against the active profile", () => {
    const profiles = fakeProfiles("verde");
    const store = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles.source,
    );
    assert.deepEqual(store.status(), { kind: "viya", profileName: "verde" });
    assert.deepEqual(store.readiness(), { ok: true, profileName: "verde" });
    store.dispose();
  });

  it("persists a change to Local across a fresh store over the same memento", () => {
    const workspaceState = memoryMemento();
    const profiles = fakeProfiles("verde");
    const first = new RunTargetStore({ workspaceState }, profiles.source);

    return first.setKind("local").then(() => {
      first.dispose();
      const second = new RunTargetStore({ workspaceState }, profiles.source);
      assert.deepEqual(second.status(), { kind: "local" });
      assert.deepEqual(second.readiness(), { ok: false, reason: "local" });
      second.dispose();
    });
  });

  it("fires onDidChange when the active profile changes without touching the target", () => {
    const profiles = fakeProfiles(undefined);
    const store = new RunTargetStore(
      { workspaceState: memoryMemento() },
      profiles.source,
    );

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

    await store.setKind("local");
    assert.equal(fired, 1);

    subscription.dispose();
    store.dispose();
  });
});
