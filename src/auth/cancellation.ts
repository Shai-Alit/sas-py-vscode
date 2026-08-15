// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Cancelling a sign-in, and how that fact survives being thrown.
 *
 * A user who closes the browser, or dismisses the paste box, or backs out of the
 * client-secret prompt, has not hit a problem — they have changed their mind.
 * The difference is worth carrying because it decides whether anything is shown:
 * a failure gets a dialog and a log line at `error`, a cancellation gets neither.
 *
 * ## Why this is a module of its own
 *
 * Two reasons, and the first is structural. `browserFlow.ts` is where the
 * cancellation is noticed and `authProvider.ts` is where the other one is, and
 * the provider already imports the flow — so putting the error beside either of
 * them makes the pair mutually dependent. The second is that nothing here needs
 * an extension host, and a predicate this subtle is worth having under the unit
 * tier where its edge cases are cheap to state.
 *
 * ## Why the check is on `name` and not `instanceof`
 *
 * Because half the callers are on the far side of an RPC hop. The compute
 * session manager asks for a token through `vscode.authentication.getSession`,
 * which reaches this extension's provider by remote procedure call even though
 * both ends are ours; the editor serialises anything thrown across it and rebuilds
 * it as a plain `Error` carrying `name`, `message` and `stack`. The prototype does
 * not make the trip, so `instanceof` — which is how every other error in this
 * codebase is recognised, and rightly — is answering a question about object
 * identity that the hop has already destroyed.
 *
 * `name` does survive, so `name` is the marker. Both callers use the same
 * predicate rather than the near one using `instanceof` and the far one using the
 * name: two checks for one fact is how they drift, and the near-side check would
 * be the one that keeps passing while the far-side one rots unnoticed.
 *
 * If a future editor build stops carrying `name` across, this degrades to what it
 * replaced — a cancellation reported as a failure — rather than to anything
 * worse. That is the whole reason the marker is a string and the fallback is
 * "treat it as a failure": the safe direction is to say too much, not too little.
 */

/**
 * Thrown when the user cancelled signing in.
 *
 * The message is deliberately plain English rather than localised. Every path
 * that catches this swallows it, so the text reaches a log line at most, and
 * reasons written to the output channel stay English by the same rule the
 * profile problems follow: a diagnostic that changes language with the editor's
 * locale is harder to search rather than easier to read. This module is also
 * pure, so `vscode.l10n` is not reachable from it in the first place.
 */
export class SignInCancelledError extends Error {
  /**
   * The marker the predicate matches on. A `static` so that the string is
   * written once: a literal repeated in the thrower and the checker is a typo
   * away from a cancellation that is silently reported as a failure, which is
   * the exact defect this module exists to fix.
   */
  static readonly NAME = "SignInCancelledError";

  constructor(message = "Signing in to SAS Viya was cancelled.") {
    super(message);
    // Assigned, because `Error` subclasses do not set it. Without this line
    // `name` is `"Error"` after compilation and the predicate below never
    // matches — including on the near side, where nothing crossed anything.
    this.name = SignInCancelledError.NAME;
  }
}

/**
 * Whether a caught value is a cancelled sign-in.
 *
 * Takes `unknown` and answers for anything, because a `catch` binding is
 * `unknown` and a value that arrived over an RPC hop is whatever the other side
 * decided to send. Anything that is not an object with the right `name` is a
 * failure, which is the answer that shows too much rather than too little.
 */
export function isSignInCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === SignInCancelledError.NAME
  );
}
