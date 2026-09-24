// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The user-facing half of the CAS localisation seam.
 *
 * `problems.ts` names what went wrong as a code and writes the English fragment
 * for the log ({@link describeCasProblem}); this file says it in the user's
 * language, for the one place a CAS-browsing failure now reaches the user
 * directly — `src/cas/casConnectCommand.ts` (8b). The read-only tree still
 * only logs, the same split `src/content/messages.ts`'s own doc comment
 * draws for its read-only tree versus `contentFileSystem.ts`.
 *
 * Adding a member to `CasProblem` breaks the build here until it is handled —
 * an explicit `string` return, no `default`, so a missing case fails to
 * type-check rather than shipping an English string to a translated user.
 */

import * as vscode from "vscode";

import { localiseAuthProblem } from "../auth/messages";
import { type CasProblem } from "./problems";

/**
 * The message to show when 8b's connect-snippet command fails partway
 * through browsing CAS. Complete, punctuated sentences, matching
 * `localiseContentProblem`'s own rule for what gets interpolated: a value
 * reaches a message only when the user can act on it.
 */
export function localiseCasProblem(problem: CasProblem): string {
  switch (problem.code) {
    case "cas-unreachable":
      return vscode.l10n.t(
        "Could not reach the CAS management service. Check that you can reach the deployment from this machine, and whether it needs a proxy. ({0})",
        problem.detail,
      );
    case "cas-response-too-large":
      // Not the proxy advice above: the request was answered, just too large
      // to read. The one real cause observed is a very wide table's page.
      return vscode.l10n.t(
        "SAS Viya's answer was larger than this extension reads at once (limit {0} MB). The table is probably too wide to read a page of here — try a table or view with fewer columns.",
        // At least 1: a cap under 1 MiB (none today) must not read "0 MB".
        String(Math.max(1, Math.floor(problem.limitBytes / (1024 * 1024)))),
      );
    case "unauthorized":
      return localiseAuthProblem(problem.problem);
    case "forbidden":
      return vscode.l10n.t(
        "SAS Viya did not permit this. Ask your SAS administrator whether your account may read this CAS server.{0}",
        detailSuffix(problem.error.detail),
      );
    case "cas-rejected":
      return vscode.l10n.t(
        "The CAS management service refused the request (HTTP {0}). See the Python on Viya log for details.{1}",
        String(problem.error.status),
        detailSuffix(problem.error.detail),
      );
    case "response-malformed":
      return vscode.l10n.t(
        "The CAS management service answered with something this extension could not read. See the Python on Viya log for details.",
      );
    case "link-missing":
      return vscode.l10n.t(
        "SAS Viya did not offer that operation to your account here. You may not have permission for it, or this deployment may not support it. See the Python on Viya log for details.",
      );
    case "foreign-link":
      return vscode.l10n.t(
        "SAS Viya sent a link pointing at another host, which was not followed. Please report this, with the Python on Viya log.",
      );
  }
}

/** A deployment's own sentence as a trailing clause, or nothing — the leading
 * space is inside the string so `{0}` sits flush against the preceding full
 * stop when there is nothing to add. Same helper `content/messages.ts` and
 * `compute/messages.ts` each carry their own copy of. */
function detailSuffix(detail: string | undefined): string {
  return detail === undefined ? "" : ` ${detail}`;
}
