// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * PKCE (RFC 7636) and the anti-CSRF `state`, for the authorization-code flow.
 *
 * **This module must never import `vscode`.** Same rule as `src/profile/model.ts`,
 * for the same reason: the unit tier runs in plain Node, and this is the file that
 * most needs to be covered there.
 *
 * Structure follows: client/src/connection/rest/auth.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied, and the
 * differences are the point — see docs/adr/0008-auth-core-transport-and-security-deltas.md.
 * Upstream's `getPKCE()` has two defects this file exists to not inherit:
 *
 *   1. It builds the verifier with `Math.random()`, one character at a time, from
 *      a 66-character alphabet. `Math.random()` is not a CSPRNG — V8 runs
 *      xorshift128+, whose internal state is recoverable from a modest number of
 *      outputs — and RFC 7636 §7.1 is explicit that the verifier must come from a
 *      cryptographic random source. A guessable verifier removes the only thing
 *      PKCE adds: an attacker holding an intercepted authorization code can
 *      produce the matching verifier and redeem it. The 66-character alphabet is
 *      also not a power of two, so even with a good source that construction has
 *      a modulo bias.
 *
 *   2. There is no `state`. Upstream sets the parameter, but to the callback URL,
 *      and never checks it on the way back. That is the code-injection attack in
 *      RFC 6749 §10.12. Minting it belongs here; comparing it belongs in the
 *      shell, which is the half that receives the callback.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Bytes of entropy behind a verifier, a challenge input, or a `state`.
 *
 * 32 bytes base64url-encode to exactly 43 characters, which is the *minimum*
 * length RFC 7636 §4.1 allows for a verifier and about twice the entropy the RFC
 * asks for. Upstream's 128 characters is the maximum, and the extra length buys
 * nothing: the verifier is hashed to a 256-bit digest either way, so entropy
 * beyond 256 bits cannot survive the challenge. What matters is that the source
 * is a CSPRNG, not that the string is long.
 */
const TOKEN_BYTES = 32;

/** Length of a base64url encoding of {@link TOKEN_BYTES} bytes. */
export const TOKEN_LENGTH = 43;

/**
 * A verifier and the challenge derived from it.
 *
 * They travel separately and must not be confused: the challenge goes out in the
 * authorize URL, over a channel that includes the user's browser and any
 * corporate TLS interception in front of it. The verifier stays in memory until
 * the token request. Sending the verifier in place of the challenge would hand
 * the secret to exactly the observer PKCE is defending against.
 */
export interface PkcePair {
  /** The secret. Held in memory, sent only in the token request. */
  verifier: string;
  /** `S256(verifier)`, base64url. Sent in the authorize URL. */
  challenge: string;
}

/**
 * A cryptographically random base64url string.
 *
 * base64url's alphabet — `A-Z a-z 0-9 - _` — is a strict subset of the
 * `unreserved` set RFC 7636 §4.1 requires of a verifier (`A-Z a-z 0-9 - . _ ~`),
 * so the output is conformant *by construction*. That is why there is no
 * character table here to review, and no rejection sampling to get wrong.
 */
function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Derives the S256 code challenge for a verifier.
 *
 * `digest("base64url")` rather than a base64 digest with `+` `/` `=` patched out
 * by three chained `.replace()` calls, which is what upstream does. Node has
 * encoded base64url natively since v15, and hand-rolled string surgery on a
 * security path is a defect waiting for the one input that exercises the branch
 * nobody tested.
 *
 * Exported separately from {@link createPkcePair} so the RFC's own test vector can
 * be run against it. A generated pair can only be checked for self-consistency,
 * which a wrong-but-consistent implementation also passes.
 */
export function deriveChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** A fresh verifier and its S256 challenge. */
export function createPkcePair(): PkcePair {
  const verifier = randomToken();
  return { verifier, challenge: deriveChallenge(verifier) };
}

/**
 * A fresh `state` value for one authorization request.
 *
 * Its only job is to be unguessable and to come back unchanged, which is why it
 * carries no data. Upstream packs the callback URL in here; anything an attacker
 * can read and reproduce cannot also serve as the proof that a callback belongs
 * to the request we started.
 */
export function createState(): string {
  return randomToken();
}

/**
 * Compares a returned `state` against the one we issued, in constant time.
 *
 * The shell calls this on the URI-handler arm of the code capture. Constant time
 * is arguably overkill for a value compared once per sign-in — this is not a
 * remote oracle an attacker can sample — but the failure mode of getting it wrong
 * is silent, the cost is a few microseconds, and a security comparison written
 * with `===` invites the next reader to copy it somewhere it does matter.
 *
 * Returns `false` rather than throwing on a length mismatch, because
 * `timingSafeEqual` throws on unequal lengths and a thrown exception mid-callback
 * is a worse outcome than a rejected callback.
 */
export function stateMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}
