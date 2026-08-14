// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  challengeProblem,
  parseBearerChallenge,
} from "../../src/auth/challenge";

/**
 * The `WWW-Authenticate` parser.
 *
 * This exists because of probe finding 9: a dead Viya token comes back as a 401
 * with a **zero-byte body**, and the entire diagnosis is in this one header. Get
 * this wrong and the most common recoverable failure in the extension — a token
 * that expired overnight — renders as "request failed".
 *
 * The distinction the suite is really guarding is between three states that all
 * arrive as a 401: a token the deployment rejected (`error="invalid_token"`, sign
 * in again), a request that carried no credentials at all (bare `Bearer`, which
 * is our bug and not the user's), and no Bearer challenge whatsoever. The parser
 * returns three different things for those, and the tests below are the reason it
 * has to keep doing so.
 */

/** Verbatim from finding 9, unfolded onto one line as a client receives it. */
const REAL_HEADER =
  'Bearer error="invalid_token", error_description="Provided token isn\'t active", error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"';

describe("parseBearerChallenge", () => {
  it("parses the header a live Viya actually sent", () => {
    const challenge = parseBearerChallenge(REAL_HEADER);

    assert.ok(challenge, "the recorded header did not parse as a challenge");
    assert.equal(challenge.params.error, "invalid_token");
    assert.equal(
      challenge.params.error_description,
      "Provided token isn't active",
    );
    assert.equal(
      challenge.params.error_uri,
      "https://tools.ietf.org/html/rfc6750#section-3.1",
    );
  });

  it("distinguishes a bare challenge from no challenge at all", () => {
    // Both are 401s and both have empty bodies. One means "you sent nothing",
    // the other means "this response is not about Bearer auth", and collapsing
    // them into a single `undefined` is how the user gets told to sign in again
    // when signing in again cannot possibly help.
    const bare = parseBearerChallenge("Bearer");
    assert.ok(bare, "a bare Bearer challenge was read as no challenge");
    assert.deepEqual(bare.params, {});

    assert.equal(parseBearerChallenge('Basic realm="viya"'), undefined);
    assert.equal(parseBearerChallenge(undefined), undefined);
    assert.equal(parseBearerChallenge(""), undefined);
  });

  it("matches the scheme without regard to case", () => {
    // RFC 7235 §2.1 makes the scheme case-insensitive, and deployments behind a
    // gateway do send `bearer`.
    const lower = parseBearerChallenge('bearer error="invalid_token"');
    assert.equal(lower?.params.error, "invalid_token");
  });

  it("keeps a comma that is inside a quoted value", () => {
    // The separator between parameters and the punctuation inside
    // `error_description` are the same character. Splitting on every comma is
    // the obvious implementation and it truncates every sentence a server
    // writes, which is precisely the text worth showing.
    const challenge = parseBearerChallenge(
      'Bearer error="invalid_token", error_description="Expired, please sign in again"',
    );

    assert.equal(
      challenge?.params.error_description,
      "Expired, please sign in again",
    );
  });

  it("reads unquoted values and tolerates spacing", () => {
    const challenge = parseBearerChallenge(
      "Bearer  error=invalid_token ,  x=1",
    );

    assert.equal(challenge?.params.error, "invalid_token");
    // No `?.` on the second read: the assert above narrows `challenge` to
    // non-nullish, and type-aware lint fails a chain it can prove is redundant.
    assert.equal(challenge.params.x, "1");
  });

  it("takes the first value when a parameter repeats", () => {
    // RFC 7235 makes a repeated auth-param an error. Rejecting the whole header
    // over it would discard a diagnosis we can still read, so the first value
    // wins — but deterministically, so the behaviour is not an accident of
    // iteration order.
    const challenge = parseBearerChallenge(
      'Bearer error="invalid_token", error="insufficient_scope"',
    );

    assert.equal(challenge?.params.error, "invalid_token");
  });

  it("does not invent parameters from a malformed header", () => {
    const challenge = parseBearerChallenge("Bearer nonsense");

    assert.ok(challenge, "a Bearer challenge with junk after it was dropped");
    assert.equal(challenge.params.error, undefined);
  });
});

/**
 * The verdict every service in this extension shares.
 *
 * Extracted in 2a-i so there is exactly one answer to "is this token dead". Two
 * copies of `error === "invalid_token"` is how one caller starts signing the
 * user out while another retries, which is the shape of a refresh loop — so what
 * these tests really guard is that the identity module and the Compute client
 * cannot drift apart.
 */
describe("challengeProblem", () => {
  it("reads a dead token as a session to sign in again for", () => {
    assert.deepEqual(
      challengeProblem(
        parseBearerChallenge(
          'Bearer error="invalid_token", error_description="Provided token isn\'t active"',
        ),
      ),
      { code: "session-expired", description: "Provided token isn't active" },
    );
  });

  it("omits the description rather than carrying an empty one", () => {
    // `exactOptionalPropertyTypes` is on, and a present-but-empty description
    // renders as a dangling colon in the message the user reads.
    assert.deepEqual(
      challengeProblem(parseBearerChallenge('Bearer error="invalid_token"')),
      { code: "session-expired" },
    );
    assert.deepEqual(
      challengeProblem(
        parseBearerChallenge(
          'Bearer error="invalid_token", error_description=""',
        ),
      ),
      { code: "session-expired" },
    );
  });

  it("reads a bare challenge as a request that carried no credentials", () => {
    // RFC 6750 §3: this is what a server sends when nothing was presented. It is
    // our bug, not the user's, and telling them to sign in again sends them
    // round a loop that cannot fix it.
    assert.deepEqual(challengeProblem(parseBearerChallenge("Bearer")), {
      code: "not-authenticated",
    });
  });

  it("says the same for a 401 with no challenge at all", () => {
    assert.deepEqual(challengeProblem(parseBearerChallenge(undefined)), {
      code: "not-authenticated",
    });
    assert.deepEqual(challengeProblem(parseBearerChallenge("")), {
      code: "not-authenticated",
    });
    assert.deepEqual(
      challengeProblem(parseBearerChallenge('Basic realm="viya"')),
      { code: "not-authenticated" },
    );
    // Passing `undefined` straight through is the same answer by a different
    // route, and it is the one a caller with no header at all takes.
    assert.deepEqual(challengeProblem(undefined), {
      code: "not-authenticated",
    });
  });

  it("declines to read anything else", () => {
    // `insufficient_scope` and whatever else RFC 6750 §3.1 permits mean
    // different things to different services, so the caller writes that arm.
    // Returning `undefined` is what keeps this function's two answers the only
    // two it is responsible for.
    assert.equal(
      challengeProblem(
        parseBearerChallenge('Bearer error="insufficient_scope"'),
      ),
      undefined,
    );
    assert.equal(
      challengeProblem(parseBearerChallenge('Bearer error="invalid_request"')),
      undefined,
    );

    // And the caller that has to answer for itself still has the token, which
    // is the point of taking the parsed challenge: one parse, both readings.
    assert.equal(
      parseBearerChallenge('Bearer error="insufficient_scope"')?.params.error,
      "insufficient_scope",
    );
  });
});
