// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import sinon from "sinon";

import {
  TOKEN_LENGTH,
  createPkcePair,
  createState,
  deriveChallenge,
  stateMatches,
} from "../../src/auth/pkce";

/**
 * Two of these tests carry the slice. The rest are hygiene.
 *
 * The trap in testing generated credentials is that the obvious properties —
 * right length, right alphabet, self-consistent challenge — are all satisfied by
 * upstream's `Math.random()` implementation. A suite made only of those would
 * have passed on the code ADR-0008 exists to replace, which makes it a
 * description of the output rather than a specification of the requirement.
 *
 * So: one test asserts the RFC's own published vector, which a self-consistent
 * but wrong derivation fails; and one asserts `Math.random` is never consulted,
 * which is the only way to state "cryptographic source" as an executable claim.
 */

/** RFC 7636 §4.1 — the characters a verifier may contain. */
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

/** base64url, unpadded. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("deriveChallenge", () => {
  it("matches the test vector in RFC 7636 Appendix B", () => {
    // Straight from the RFC. This is the assertion a hand-rolled base64url
    // fails: three chained .replace() calls over a base64 digest agree with
    // themselves on a round trip, so only an externally published pair can tell
    // a correct derivation from a merely consistent one.
    assert.equal(
      deriveChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("produces unpadded base64url of the ASCII bytes of the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    assert.match(challenge, BASE64URL);
    assert.equal(challenge.length, TOKEN_LENGTH);
    assert.ok(!challenge.includes("="), "must not be padded");
    assert.equal(
      challenge,
      createHash("sha256").update(verifier, "ascii").digest("base64url"),
    );
  });

  it("is deterministic", () => {
    assert.equal(deriveChallenge("abc"), deriveChallenge("abc"));
    assert.notEqual(deriveChallenge("abc"), deriveChallenge("abd"));
  });
});

describe("createPkcePair", () => {
  it("never consults Math.random", () => {
    // The executable form of "use a cryptographically secure source". Upstream
    // calls Math.random() once per character; any implementation that does the
    // same trips callCount here. The differing verifiers under a stubbed
    // Math.random are the belt to that braces — a frozen PRNG would return the
    // same string twice.
    const random = sinon.stub(Math, "random").returns(0.5);
    try {
      const first = createPkcePair();
      const second = createPkcePair();

      assert.equal(random.callCount, 0, "Math.random must not be reachable");
      assert.notEqual(first.verifier, second.verifier);
      assert.notEqual(first.challenge, second.challenge);
    } finally {
      random.restore();
    }
  });

  it("emits a verifier inside the RFC 7636 length and character bounds", () => {
    const { verifier } = createPkcePair();
    assert.match(verifier, UNRESERVED);
    assert.equal(verifier.length, TOKEN_LENGTH);
    assert.ok(verifier.length >= 43 && verifier.length <= 128);
  });

  it("does not repeat itself across many draws", () => {
    // 256 bits each: a collision here means the source is broken, not unlucky.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(createPkcePair().verifier);
    }
    assert.equal(seen.size, 500);
  });
});

describe("createState", () => {
  it("is unguessable and carries no data", () => {
    const state = createState();
    assert.match(state, BASE64URL);
    assert.equal(state.length, TOKEN_LENGTH);
    // Upstream's state is the callback URL, which is neither secret nor
    // unpredictable. If this ever starts containing a scheme, someone has
    // reintroduced that.
    assert.ok(!state.includes(":"), "state must not encode a URL");
  });

  it("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(createState());
    }
    assert.equal(seen.size, 500);
  });
});

describe("stateMatches", () => {
  it("accepts the value it was issued", () => {
    const state = createState();
    assert.equal(stateMatches(state, state), true);
  });

  it("rejects a different value of the same length", () => {
    const a = "a".repeat(TOKEN_LENGTH);
    const b = `${"a".repeat(TOKEN_LENGTH - 1)}b`;
    assert.equal(stateMatches(a, b), false);
  });

  it("rejects a length mismatch instead of throwing", () => {
    // timingSafeEqual throws on unequal lengths. A throw inside a URI-handler
    // callback is a worse outcome than a discarded callback, so the guard has to
    // come first — this is the test that fails if someone removes it.
    assert.equal(stateMatches("short", "much longer value"), false);
    assert.equal(stateMatches("", ""), false);
  });

  it("rejects an empty received state", () => {
    // A callback with no state at all must not pass by comparing empty to empty.
    assert.equal(stateMatches(createState(), ""), false);
  });
});
