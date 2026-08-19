// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The user-facing half of the compute localisation seam.
 *
 * `problems.ts` names what went wrong as a code and writes the English fragment
 * that goes to the log; this file says it in the user's language. The same split
 * as `src/auth/problems.ts` and `src/auth/messages.ts`, down to the file names,
 * and for the same reason: the core has to load in the unit tier, outside an
 * extension host, and `l10n.t()` lives on the `vscode` module.
 *
 * Adding a member to `ComputeProblem` breaks the build here until it is handled:
 * with an explicit `string` return and no `default` branch, a missing case makes
 * the function implicitly return `undefined`, which does not type-check. There is
 * deliberately no fallback message, because a fallback turns a compile error into
 * an English string shipped to a translated user.
 *
 * ## What is not rendered here
 *
 * **`session-gone` has a message, and it is nearly always wrong to show it.**
 * A session expiring after fifteen idle minutes is lunch, not a failure, and the
 * caller's correct response is to start another one without saying anything. The
 * message exists for the one case where that recovery is not available — see the
 * note on the case itself.
 *
 * **Cancellation is not here at all.** It is not a `ComputeProblem`; see the note
 * in `./cancellation`.
 */

import * as vscode from "vscode";

import { localiseAuthProblem } from "../auth/messages";
import type { ComputeProblem } from "./problems";

/**
 * The message to show the user when a compute call fails.
 *
 * Complete sentences, capitalised and punctuated, unlike the lower-case fragments
 * `describeComputeProblem` writes to the log. The two are allowed to differ and
 * mostly do — one is read by the person waiting for their code to run, the other
 * by whoever is reading a log a week later.
 *
 * The rule for what gets interpolated is the one `auth/messages.ts` follows: a
 * value reaches a message only when the user can act on it. A context name and a
 * link relation qualify. A `ViyaError`'s `detail` qualifies too — it is the
 * deployment's own sentence about what it refused, and it is the only thing
 * standing between an administrator and a guess — but the correlator and error
 * code do not, and stay in the log where support can find them.
 */
export function localiseComputeProblem(problem: ComputeProblem): string {
  switch (problem.code) {
    case "compute-unreachable":
      // `detail` is a method, an href and a transport message. Shown because
      // this is the failure most likely to be a proxy or a VPN, and the person
      // who can fix that is the one reading the notification.
      return vscode.l10n.t(
        "Could not reach the SAS Viya compute service. Check that you can reach the deployment from this machine, and whether it needs a proxy. ({0})",
        problem.detail,
      );
    case "unauthorized":
      // Delegated, not duplicated — the whole reason the variant carries an
      // `AuthProblem` rather than a status code. Slice 1c already words every
      // reading of a 401, including the one that says "sign in again".
      return localiseAuthProblem(problem.problem);
    case "forbidden":
      // The one failure whose remedy is a conversation with an administrator, so
      // the message is written to be relayed to one.
      return vscode.l10n.t(
        "SAS Viya did not permit this. Ask your SAS administrator whether your account may start a session on this compute context.{0}",
        detailSuffix(problem.error.detail),
      );
    case "session-gone":
      // Shown only where reconnecting is not on the table — a cancel or a
      // disconnect aimed at a session that has already gone. The wording is a
      // statement of fact with no instruction, because by the time anyone reads
      // it the thing they wanted to happen has effectively happened.
      return vscode.l10n.t(
        "The SAS Viya session is no longer available. It may have been idle too long, or been ended elsewhere.",
      );
    case "session-not-ready":
      // Both numbers are the user's, not diagnostics: one says how long we
      // waited, the other says what it was doing all that time, and without them
      // "it is taking a while" is not something anyone can act on.
      return vscode.l10n.t(
        'The SAS Viya session was still "{0}" after {1} seconds, so it was given up on. This usually means the compute context cannot start a SAS process — your SAS administrator can say why.',
        problem.state,
        String(problem.seconds),
      );
    case "no-such-context":
      // Both readings, because the deployment gives one answer to two questions:
      // the contexts collection returns an empty `items` whether the name is
      // wrong or the user simply may not see it.
      return vscode.l10n.t(
        'No compute context named "{0}" is available. Check the name against the compute contexts on your deployment — you may not have permission to see it.',
        problem.name,
      );
    case "compute-rejected":
      return vscode.l10n.t(
        "SAS Viya refused the request (HTTP {0}). See the Python on Viya log for details.{1}",
        String(problem.error.status),
        detailSuffix(problem.error.detail),
      );
    case "response-malformed":
      // `detail` describes the shape of a response body — which field was
      // missing, what arrived instead. That is a sentence for whoever debugs it,
      // not for the person trying to run a file. It is in the log, and the
      // message says so.
      return vscode.l10n.t(
        "SAS Viya answered with something this extension could not read. See the Python on Viya log for details.",
      );
    case "link-missing":
      // Deliberately *not* "this deployment does not offer that operation",
      // which is what this said until finding 54 measured why it is wrong: the
      // response a link is missing from is one representation read by one
      // account, and Viya composes a link set per representation — and,
      // per SAS's REST usage notes, per caller's authorization. Blaming the
      // deployment sends someone to their administrator to ask about a
      // capability that is probably present. The two readings that survive the
      // finding are both in the sentence, and both are actionable.
      return vscode.l10n.t(
        "SAS Viya did not offer that operation to your account here. You may not have permission for it, or this deployment may not support it. See the Python on Viya log for details.",
      );
    case "foreign-link":
      // A security stop, and worded as one. Nothing observed on a real
      // deployment does this, so the honest message is that we refused rather
      // than that it failed — and the person who needs to hear it is whoever
      // administers whatever rewrote the response.
      return vscode.l10n.t(
        "SAS Viya sent a link pointing at another host, which was not followed. Please report this, with the Python on Viya log.",
      );
  }
}

/**
 * A deployment's own sentence, as a trailing clause, or nothing.
 *
 * Separated out because two cases append it identically and the empty case has
 * to produce no stray punctuation. The leading space is inside the returned
 * string so the `{0}` in the message above sits flush against the full stop
 * before it when there is nothing to add.
 */
function detailSuffix(detail: string | undefined): string {
  return detail === undefined ? "" : ` ${detail}`;
}
