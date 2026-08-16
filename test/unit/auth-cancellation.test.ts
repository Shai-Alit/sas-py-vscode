// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  SignInCancelledError,
  isSignInCancelled,
} from "../../src/auth/cancellation";

/**
 * The predicate that decides whether the user sees an error dialog.
 *
 * Both directions are worth stating. A cancellation misread as a failure is the
 * defect this module was written for — an error message for something the user
 * deliberately chose to do. A failure misread as a cancellation is worse and
 * quieter: a deployment that refused the sign-in would show nothing at all, and
 * the user would be left pressing a command that appears to do nothing.
 */

/**
 * What an error looks like after the editor has carried it between extension
 * hosts: a plain `Error` with the original `name`, `message` and `stack` copied
 * onto it, and no trace of the class it was thrown as.
 *
 * Written out here rather than exercised for real because there is no way to
 * exercise it for real — driving the hop needs the *activated* provider, whose
 * browser ports no test can reach, so it would open a browser and block. This
 * is a statement of the shape the check has to survive, and if the editor ever
 * changes that shape this test keeps passing while the behaviour breaks. That
 * risk is recorded rather than solved: see `src/auth/cancellation.ts` for why
 * the failure direction is the safe one.
 */
function afterAnRpcHop(error: Error): Error {
  const revived = new Error(error.message);
  revived.name = error.name;
  // Conditional because `stack` is optional and this project forbids assigning
  // `undefined` to an optional property. The editor copies it when it has one.
  if (error.stack !== undefined) revived.stack = error.stack;
  return revived;
}

describe("isSignInCancelled", () => {
  it("recognises the error as thrown", () => {
    assert.ok(isSignInCancelled(new SignInCancelledError()));
  });

  it("recognises the error after it has crossed an RPC hop", () => {
    // The reason the check is on `name` and not `instanceof`. This value is a
    // plain `Error`, so `instanceof SignInCancelledError` is false for it.
    const revived = afterAnRpcHop(new SignInCancelledError());

    assert.ok(!(revived instanceof SignInCancelledError));
    assert.ok(isSignInCancelled(revived));
  });

  it("carries a name that a subclass would not have set on its own", () => {
    // `Error` subclasses inherit `name` as "Error"; nothing assigns the class
    // name for you. Without the assignment in the constructor the marker is
    // wrong everywhere, including on the near side where nothing was serialised.
    assert.equal(new SignInCancelledError().name, "SignInCancelledError");
  });

  it("says no to an ordinary failure", () => {
    assert.ok(!isSignInCancelled(new Error("the deployment refused")));
  });

  it("says no to an error that only borrows the message", () => {
    // A failure whose text happens to mention cancelling is still a failure.
    // Matching on the message is how this check would have been written if the
    // marker were not deliberate, and it is why the marker is deliberate.
    const lookalike = new Error("Signing in to SAS Viya was cancelled.");

    assert.ok(!isSignInCancelled(lookalike));
  });

  it("says no to whatever else a catch can be handed", () => {
    // `catch` binds `unknown`, and an RPC hop hands back whatever the other side
    // sent. Anything unrecognised has to read as a failure, because showing an
    // unexpected error is recoverable and swallowing one is not.
    for (const value of [
      undefined,
      null,
      "SignInCancelledError",
      42,
      {},
      { name: "Error" },
      [],
    ]) {
      // `JSON.stringify` rather than `String`: half of these are objects, and
      // `String({})` is "[object Object]" — which would name every failing case
      // identically, in a loop whose whole point is which of them failed.
      assert.ok(
        !isSignInCancelled(value),
        `${JSON.stringify(value)} read as cancelled`,
      );
    }
  });

  it("says yes to a bare object carrying the marker", () => {
    // Not a shape we throw, and the point is that the check does not depend on
    // the prototype at all: whatever the hop rebuilds it as, the name decides.
    assert.ok(isSignInCancelled({ name: "SignInCancelledError" }));
  });
});
