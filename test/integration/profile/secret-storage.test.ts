// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { createProfile, secretKey } from "../../../src/profile/model";
import { ProfileStore } from "../../../src/profile/store";
import {
  memoryMemento,
  memorySecrets,
  testLogChannel,
} from "../../helpers/auth-host";

/**
 * Where `ProfileStore` puts a client secret, and — the part this suite exists
 * for — where it puts the *absence* of one.
 *
 * A registered OAuth client that is public has no secret, and "no secret" has to
 * be remembered, or every sign-in asks a question the user answered on the first
 * one. The obvious place to remember it is `SecretStorage`, storing `""`, and
 * that does not work: VS Code encrypts on write and, on read, discards the entry
 * when the *stored* value is falsy. Against an OS keyring `""` encrypts to a
 * non-empty blob and survives; when there is no keyring the storage falls back to
 * an in-memory backend whose encryption is the identity function, so `""` is
 * stored as `""` and read back as `undefined`. Linux containers, remote SSH
 * without a keyring, and CI are exactly that case — the environments where the
 * re-prompt would be blamed on anything but this.
 *
 * So the claim lives in `globalState` and the secret store holds only secrets,
 * and these tests pin the two apart: what is in each, under which key, after each
 * of the three things a user can do.
 *
 * The doubles are the usual concession — `secrets` and `globalState` arrive on an
 * `ExtensionContext`, and a test is not an extension. What is real here is the
 * store: the same class `activate` constructs, loaded under the host's module
 * resolution, reading real `workspace.getConfiguration`.
 */
describe("profile secret storage", () => {
  // One channel for the suite, not one per test: see `testLogChannel`.
  const log = testLogChannel("profile store");

  const profile = createProfile({
    id: "profile-id",
    endpoint: "https://viya.example.com",
    clientId: "a-registered-client",
  });

  let secrets: ReturnType<typeof memorySecrets>;
  let globalState: ReturnType<typeof memoryMemento>;
  let store: ProfileStore;

  beforeEach(() => {
    secrets = memorySecrets();
    globalState = memoryMemento();
    store = new ProfileStore(
      { secrets, globalState, workspaceState: memoryMemento() },
      log,
    );
  });

  afterEach(() => {
    store.dispose();
    secrets.dispose();
  });

  it("has nothing to say about a profile nobody has answered for", async () => {
    // `undefined` rather than `""`, and the difference is the whole design:
    // this is the only state that means "ask".
    assert.equal(await store.secret(profile), undefined);
  });

  it("stores a real secret in SecretStorage, keyed on the profile id", async () => {
    await store.setSecret(profile, "s3cret-placeholder");

    assert.equal(await store.secret(profile), "s3cret-placeholder");
    assert.deepEqual(
      [...secrets.entries.keys()],
      [secretKey(profile)],
      "the secret is not under the key a rename would preserve",
    );
  });

  it("remembers an empty answer, and does not put it in SecretStorage", async () => {
    await store.setSecret(profile, "");

    assert.equal(
      await store.secret(profile),
      "",
      "a public client would be re-prompted at every sign-in",
    );
    assert.deepEqual(
      [...secrets.entries.keys()],
      [],
      "an empty string was written to the secret store, where it may not survive",
    );
    assert.deepEqual(
      globalState.get<string[]>("pythonOnViya.clientsWithoutSecret"),
      [profile.id],
    );
  });

  it("retracts the claim when a real secret arrives later", async () => {
    // The order that matters: someone declares the client public, then registers
    // a secret for it. A stale claim would shadow the secret they just gave us.
    await store.setSecret(profile, "");
    await store.setSecret(profile, "s3cret-placeholder");

    assert.equal(await store.secret(profile), "s3cret-placeholder");
    assert.equal(
      globalState.get<string[]>("pythonOnViya.clientsWithoutSecret"),
      undefined,
      "the key is left behind empty rather than removed",
    );
  });

  it("contradicts a stored secret when the answer becomes empty", async () => {
    await store.setSecret(profile, "s3cret-placeholder");
    await store.setSecret(profile, "");

    assert.equal(await store.secret(profile), "");
    assert.deepEqual([...secrets.entries.keys()], []);
  });

  it("clearSecret forgets both halves", async () => {
    // Deleting a profile goes through here. Leaving either half behind would
    // hand the next profile that reuses the id someone else's answer.
    await store.setSecret(profile, "");
    await store.clearSecret(profile);
    assert.equal(await store.secret(profile), undefined);

    await store.setSecret(profile, "s3cret-placeholder");
    await store.clearSecret(profile);
    assert.equal(await store.secret(profile), undefined);
    assert.deepEqual([...secrets.entries.keys()], []);
  });

  it("keeps one profile's answer out of another's", async () => {
    const other = createProfile({
      id: "other-id",
      endpoint: "https://viya.example.com",
      clientId: "another-client",
    });

    await store.setSecret(profile, "");
    await store.setSecret(other, "s3cret-placeholder");

    assert.equal(await store.secret(profile), "");
    assert.equal(await store.secret(other), "s3cret-placeholder");
  });
});
