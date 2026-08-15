// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { sessionSecretKey } from "../../src/auth/signIn";
import {
  BINDING_SCHEMA_VERSION,
  bindingMatches,
  parseBinding,
  serializeBinding,
  sessionBindingKey,
  type SessionBinding,
} from "../../src/compute/binding";

/**
 * What a workspace writes down about its compute session.
 *
 * The value is small and the ways it can be wrong are all cheap to recover from,
 * which is exactly why the tests here are about *rejection* rather than about
 * round trips: the round trip is two lines of `JSON`, and every interesting case
 * is a stored string that is not what this wrote — an older schema, a hand-edit,
 * a truncated write, or another extension's value under a key that happens to
 * collide.
 *
 * The key test is the one that would otherwise be found in production. The
 * refresh token already lives under `pythonOnViya.session.<id>`, in a different
 * store; two things named the same thing eventually get treated as one, and the
 * assertion below is what stops the names converging.
 */

const PROFILE_ID = "9d1f3a2e-6c47-4b58-8a09-2f7e5c1d3b64";
const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const CONTEXT = "SAS Job Execution compute context";

function binding(init?: Partial<SessionBinding>): SessionBinding {
  return {
    id: init?.id ?? SESSION_ID,
    context: init?.context ?? CONTEXT,
  };
}

describe("sessionBindingKey", () => {
  it("keys on the profile id", () => {
    assert.equal(
      sessionBindingKey(PROFILE_ID),
      `pythonOnViya.computeSession.${PROFILE_ID}`,
    );
  });

  it("does not collide with the refresh token's key", () => {
    // Different stores, so a collision could not actually lose a token. This is
    // about the names: `pythonOnViya.session.<id>` is taken, and reusing it here
    // would make "the session key" ambiguous in every conversation afterwards.
    assert.notEqual(
      sessionBindingKey(PROFILE_ID),
      sessionSecretKey(PROFILE_ID),
    );
  });

  it("refuses a blank profile id", () => {
    // A shared key across every profile with no id is worse than no key: two
    // deployments would reattach to each other's sessions.
    for (const blank of ["", "   "]) {
      assert.throws(() => sessionBindingKey(blank));
    }
  });
});

describe("serializeBinding and parseBinding", () => {
  it("round-trips a binding", () => {
    assert.deepEqual(parseBinding(serializeBinding(binding())), binding());
  });

  it("writes the schema version", () => {
    const written: unknown = JSON.parse(serializeBinding(binding()));
    assert.ok(typeof written === "object" && written !== null);
    assert.equal(
      (written as Record<string, unknown>).v,
      BINDING_SCHEMA_VERSION,
    );
  });

  it("keeps a context name that JSON would otherwise mangle", () => {
    const awkward = binding({ context: 'He said "run", then \\ left' });

    assert.deepEqual(parseBinding(serializeBinding(awkward)), awkward);
  });

  it("rejects a value from a schema it does not know", () => {
    const future = JSON.stringify({
      v: BINDING_SCHEMA_VERSION + 1,
      id: SESSION_ID,
      context: CONTEXT,
    });

    // Refused rather than read for the fields it recognises: a newer writer is
    // entitled to have changed what the fields mean.
    assert.equal(parseBinding(future), undefined);
  });

  it("rejects anything that is not the shape this wrote", () => {
    const wrong: readonly unknown[] = [
      undefined,
      null,
      "",
      "   ",
      "not json at all",
      '{"v":1,"id":"x"',
      JSON.stringify([{ v: 1, id: SESSION_ID, context: CONTEXT }]),
      JSON.stringify({ id: SESSION_ID, context: CONTEXT }),
      JSON.stringify({ v: 1, context: CONTEXT }),
      JSON.stringify({ v: 1, id: SESSION_ID }),
      JSON.stringify({ v: 1, id: "", context: CONTEXT }),
      JSON.stringify({ v: 1, id: SESSION_ID, context: "" }),
      JSON.stringify({ v: 1, id: 7, context: CONTEXT }),
      JSON.stringify({ v: "1", id: SESSION_ID, context: CONTEXT }),
      // A structured value rather than the string this writes. `workspaceState`
      // would accept one, so something else could have left it there.
      { v: 1, id: SESSION_ID, context: CONTEXT },
    ];

    // By position rather than by value: `JSON.stringify` is typed as returning a
    // string but returns `undefined` for `undefined`, so a message built from it
    // needs a fallback the type system insists cannot happen. The index says
    // which entry failed without arguing with either.
    for (const [index, raw] of wrong.entries()) {
      assert.equal(
        parseBinding(raw),
        undefined,
        `entry ${String(index)} (${typeof raw}) was read as a binding`,
      );
    }
  });
});

describe("bindingMatches", () => {
  it("accepts the context the session was created from", () => {
    assert.equal(bindingMatches(binding(), CONTEXT), true);
  });

  it("rejects a context the user has since changed", () => {
    // The case the field exists for: without it, editing the profile's context
    // and reloading reattaches to a session built from the old one, and the
    // change appears to do nothing at all.
    assert.equal(
      bindingMatches(binding(), "Data Mining compute context"),
      false,
    );
  });

  it("compares case-sensitively, because the deployment does", () => {
    // Viya's `eq(name,…)` filter is case-sensitive, so the lower-case spelling
    // is a different lookup rather than the same one written differently.
    assert.equal(bindingMatches(binding(), CONTEXT.toLowerCase()), false);
  });
});
