// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The user-facing half of the auth localisation seam.
 *
 * `problems.ts` names what went wrong as a code and writes the English fragment
 * that goes to the log; this file says it in the user's language. Same split as
 * `src/profile/model.ts` and `src/profile/problems.ts`, and for the same reason:
 * the core has to load in the unit tier, outside an extension host, and
 * `l10n.t()` lives on the `vscode` module.
 *
 * The naming differs from the profile pair and it is worth saying why, because
 * the asymmetry looks like an oversight. There, `problems.ts` is the renderer.
 * Here, `problems.ts` was already taken by the codes — auth needed its problem
 * type before it had a shell to render it — so the renderer is `messages.ts`.
 * Renaming the core file to match would have churned five importers to buy
 * nothing.
 *
 * Adding a member to `AuthProblem` breaks the build here until it is handled:
 * with an explicit `string` return and no `default` branch, a missing case makes
 * the function implicitly return `undefined`, which does not type-check. There is
 * deliberately no fallback message, because a fallback turns a compile error into
 * an English string shipped to a translated user.
 */

import * as vscode from "vscode";

import type { AuthProblem } from "./problems";

/**
 * The message to show the user when signing in fails.
 *
 * These are complete sentences, capitalised and punctuated, unlike the lower-case
 * fragments {@link describeAuthProblem} writes to the log. The two are allowed to
 * differ and mostly do — one is read by the person who just clicked Sign In, the
 * other by whoever is reading a log a week later, and they need different things.
 *
 * Nothing here interpolates anything that could be a credential. The only values
 * that reach a message are the OAuth `error` and `error_description` fields,
 * which RFC 6749 §4.1.2.1 defines as human-readable diagnostics, and a version
 * string. See the rule at the top of `problems.ts`.
 */
export function localiseAuthProblem(problem: AuthProblem): string {
  switch (problem.code) {
    case "client-id-required":
      // Naming the two grant types is the difference between a request an
      // administrator can act on immediately and a conversation. The user is the
      // one who has to relay it, so it has to survive being read aloud.
      return vscode.l10n.t(
        "This deployment ({0}) has no built-in sign-in client. Ask your SAS administrator to register an OAuth client with the authorization_code and refresh_token grant types, then set its ID on this connection profile.",
        problem.deployment,
      );
    case "oauth-rejected":
      return problem.description === undefined
        ? vscode.l10n.t(
            "The deployment refused the sign-in: {0}",
            problem.error,
          )
        : vscode.l10n.t(
            "The deployment refused the sign-in: {0} ({1})",
            problem.error,
            problem.description,
          );
    case "token-endpoint-unreachable":
      return vscode.l10n.t(
        "Could not reach {0} to finish signing in. Check the endpoint on the connection profile, and whether this machine needs a proxy to reach it.",
        problem.detail,
      );
    case "token-response-malformed":
      // `detail` is deliberately not shown. It describes the shape of a response
      // body — which field was missing, what type arrived instead — and that is a
      // sentence for whoever debugs it, not for the person trying to sign in. It
      // is in the log, and the message says so.
      return vscode.l10n.t(
        "The deployment answered the sign-in with something that is not a token response. See the Python on Viya log for details.",
      );
    case "state-mismatch":
      // Worded as a fact rather than an accusation. The overwhelmingly likely
      // cause is a stale link from an earlier attempt, and telling that user they
      // may have been attacked is both alarming and usually wrong.
      return vscode.l10n.t(
        "A sign-in response arrived that this window did not ask for, so it was ignored. If you were signing in, try again from this window.",
      );
    case "session-expired":
      // The description is not shown. It is server-authored and useful in a log,
      // but the user has exactly one thing to do here and a second sentence
      // quoting "Provided token isn't active" only obscures it.
      return vscode.l10n.t(
        "Your Viya sign-in has expired. Sign in again to continue.",
      );
    case "not-authenticated":
      // Nothing reached the deployment, because there was no token to send:
      // either no session is held (signed out, or dropped after an endpoint
      // edit), or the token source failed and the log has its reason. Not
      // "sign in again" — the caller that raises this
      // with a live session to offer (SAS Content's `noSession`) words its own
      // prompt, and a broken renewal is not fixed by repeating it.
      return vscode.l10n.t(
        "Could not get a Viya sign-in for this request. See the Python on Viya log for details.",
      );
    case "token-rejected":
      // The same remedy as `session-expired`, worded without claiming the
      // token expired: the deployment only said it would not take it.
      return vscode.l10n.t(
        "SAS Viya did not accept your sign-in. Sign in again to continue.",
      );
    case "identity-unavailable":
      // `detail` stays out of the message for the same reason as
      // `token-response-malformed`: it describes a response shape, which is a
      // sentence for whoever debugs this rather than for whoever hit it.
      return vscode.l10n.t(
        "Signed in, but Viya would not say who you are signed in as. See the Python on Viya log for details.",
      );
  }
}
