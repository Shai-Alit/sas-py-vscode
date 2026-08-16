// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  getSessionOptions,
  type AuthRequest,
} from "../../src/auth/sessionRequest";

/**
 * What we actually ask `vscode.authentication.getSession` for.
 *
 * This suite exists because of a defect it would have caught. Connecting after
 * switching to a second profile opened the browser on the *first* profile's
 * deployment, and every test in the repository passed, because the session
 * manager's injected authentication port sits above the mapping from request to
 * options — the tests could see which `AuthRequest` was chosen and nothing else.
 *
 * So the assertions here are deliberately literal. They are not "the options
 * look about right"; they are the exact object, field for field, because the
 * fields are the whole content and an option missing from an expectation is an
 * option nobody is checking. `deepEqual` against a whole literal is what makes a
 * quietly dropped flag fail.
 */

const ACCOUNT = {
  id: "https://viya.example.com::9f4c1b7a-2e58-4d63-8c10-5b7a3e2f6d94",
  label: "Ada Lovelace",
};

describe("getSessionOptions", () => {
  it("names the account and accepts an existing session when one is known", () => {
    assert.deepEqual(
      getSessionOptions({ kind: "known", account: ACCOUNT }),
      { createIfNone: true, account: ACCOUNT },
      "a known account was not asked for by name",
    );
  });

  it("clears the remembered account when signing in to a new deployment", () => {
    // The defect, stated as a test. Without `clearSessionPreference`, VS Code
    // fills in the account it remembered from the last interactive sign-in and
    // hands it to `createSession`, which honours it over the active profile —
    // so a window that has signed in to one deployment tries to sign in to that
    // same one again no matter which profile is active.
    assert.deepEqual(
      getSessionOptions({ kind: "new" }),
      { forceNewSession: true, clearSessionPreference: true },
      "the host's remembered account was left free to override the profile",
    );
  });

  it("never asks a new sign-in to reuse a session", () => {
    // `forceNewSession` and `createIfNone` together are rejected at run time by
    // the host, which is a crash rather than a wrong deployment, and therefore
    // worth its own assertion rather than trusting the literal above to be read.
    const options = getSessionOptions({ kind: "new" });

    assert.equal(
      "createIfNone" in options,
      false,
      "createIfNone was sent alongside forceNewSession, which the host rejects",
    );
  });

  it("stays silent and writes nothing when polling behind another request", () => {
    // No `clearSessionPreference` here, and that omission is the assertion:
    // clearing is a write, the Accounts menu polls this arm, and a read that
    // mutates state on every poll is not a read.
    assert.deepEqual(
      getSessionOptions({ kind: "silent", account: ACCOUNT }),
      { silent: true, account: ACCOUNT },
      "a silent poll did not ask silently, or did not ask for its account",
    );
  });

  it("omits the account key entirely when a silent request has none", () => {
    // Omitted rather than present-and-undefined. Under
    // `exactOptionalPropertyTypes` the two are different types, and to the host
    // they are different questions: `{account: undefined}` is a filter that
    // matches nothing on some paths, where an absent key is no filter at all.
    const options = getSessionOptions({ kind: "silent" });

    assert.deepEqual(
      options,
      { silent: true },
      "an accountless silent request carried an account key",
    );
    assert.equal(
      "account" in options,
      false,
      "the account key was present with an undefined value",
    );
  });

  it("answers every request shape", () => {
    // The mapping is an exhaustive switch with no `default`, so a fourth arm
    // fails to compile rather than falling through. This is the run-time half of
    // that: each shape produces options, and no two shapes produce the same set
    // of keys, which is what "these are three different questions" means.
    const requests: AuthRequest[] = [
      { kind: "known", account: ACCOUNT },
      { kind: "new" },
      { kind: "silent" },
    ];

    const shapes = requests.map((request) =>
      Object.keys(getSessionOptions(request)).sort().join(","),
    );

    assert.equal(
      new Set(shapes).size,
      requests.length,
      `two request shapes asked the same question: ${shapes.join(" | ")}`,
    );
  });
});
