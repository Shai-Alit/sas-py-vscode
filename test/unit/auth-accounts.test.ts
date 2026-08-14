// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  diffSessions,
  isEmptyDiff,
  type SessionSummary,
} from "../../src/auth/accounts";

/**
 * The Accounts-menu diff.
 *
 * `onDidChangeSessions` is the signal VS Code acts on, and the provider fires it
 * from these two functions. Testing it through an extension host would mean
 * asserting on event volume — counting how many times something happened, which
 * is the flakiest kind of assertion there is. Here it is arithmetic over two
 * arrays.
 *
 * The case worth the file on its own is the third one: a session whose id
 * survives but whose account changed. Reporting that as an add plus a remove
 * makes the menu drop a row and grow it back, and reporting it as nothing at all
 * leaves the wrong name on screen.
 */

function summary(
  id: string,
  accountId: string,
  accountLabel: string,
): SessionSummary {
  return { id, accountId, accountLabel };
}

const prod = summary(
  "profile-prod",
  "https://viya.example.com::a7f3c1d9e2b4f6a80",
  "Dana Whitfield",
);
const staging = summary(
  "profile-test",
  "https://viya-test.example.com::b1c2d3e4f5a6b7c80",
  "Dana Whitfield",
);

describe("diffSessions", () => {
  it("reports nothing when nothing moved", () => {
    const diff = diffSessions([prod, staging], [prod, staging]);

    assert.ok(isEmptyDiff(diff));
  });

  it("is unaffected by order", () => {
    // The provider builds its list by walking the configured profiles, and the
    // order of a settings object is not something to rely on. An event fired
    // because two keys swapped places would be pure noise.
    const diff = diffSessions([prod, staging], [staging, prod]);

    assert.ok(isEmptyDiff(diff));
  });

  it("reports a first sign-in as added", () => {
    const diff = diffSessions([], [prod]);

    assert.deepEqual(diff.added, [prod]);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
  });

  it("reports a sign-out as removed, and leaves the other session alone", () => {
    // Decision 10, and the behaviour a review pass is most likely to miss:
    // signing out of one deployment must not disturb the other.
    const diff = diffSessions([prod, staging], [staging]);

    assert.deepEqual(diff.removed, [prod]);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.changed, []);
  });

  it("reports a renamed user as changed, not as a new account", () => {
    const renamed = summary(prod.id, prod.accountId, "Dana Whitfield-Okoro");
    const diff = diffSessions([prod], [renamed]);

    assert.deepEqual(diff.changed, [renamed]);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
  });

  it("reports a profile repointed at another deployment as changed", () => {
    // Same profile id, genuinely different account behind it. The id is what
    // VS Code tracks, so this is an update in place rather than a swap.
    const repointed = summary(
      prod.id,
      "https://viya-dr.example.com::a7f3c1d9e2b4f6a80",
      prod.accountLabel,
    );
    const diff = diffSessions([prod], [repointed]);

    assert.deepEqual(diff.changed, [repointed]);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
  });

  it("carries the new value in changed, never the old one", () => {
    // A listener uses this to update what is on screen. Handing it the value
    // that has just stopped being true would be worse than firing nothing.
    const renamed = summary(prod.id, prod.accountId, "New Name");
    const diff = diffSessions([prod], [renamed]);

    assert.equal(diff.changed[0]?.accountLabel, "New Name");
  });

  it("handles the two lists changing completely", () => {
    const diff = diffSessions([prod], [staging]);

    assert.deepEqual(diff.added, [staging]);
    assert.deepEqual(diff.removed, [prod]);
    assert.deepEqual(diff.changed, []);
  });

  it("mutates neither list", () => {
    const before = [prod];
    const after = [staging];
    diffSessions(before, after);

    assert.deepEqual(before, [prod]);
    assert.deepEqual(after, [staging]);
  });
});

describe("isEmptyDiff", () => {
  it("is false when any single arm is populated", () => {
    assert.equal(
      isEmptyDiff({ added: [prod], removed: [], changed: [] }),
      false,
    );
    assert.equal(
      isEmptyDiff({ added: [], removed: [prod], changed: [] }),
      false,
    );
    assert.equal(
      isEmptyDiff({ added: [], removed: [], changed: [prod] }),
      false,
    );
  });

  it("is true only when all three are", () => {
    assert.equal(isEmptyDiff({ added: [], removed: [], changed: [] }), true);
  });
});
