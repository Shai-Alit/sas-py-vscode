// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The user-facing half of the content localisation seam.
 *
 * `problems.ts` names what went wrong as a code and writes the English fragment
 * for the log ({@link describeContentProblem}); this file says it in the user's
 * language, for the one place a content failure now reaches the user directly —
 * `src/content/contentFileSystem.ts`, when an open or a save they asked for
 * fails. The read-only tree still only logs. Same split as
 * `src/compute/messages.ts` / `src/auth/messages.ts`, down to the file names,
 * and for the same reason: the core loads in the unit tier, outside an
 * extension host, and `l10n.t()` is on the `vscode` module.
 *
 * Adding a member to `ContentProblem` breaks the build here until it is
 * handled — an explicit `string` return, no `default`, so a missing case fails
 * to type-check rather than shipping an English string to a translated user.
 */

import * as vscode from "vscode";

import { localiseAuthProblem } from "../auth/messages";
import { type ContentProblem } from "./problems";

/**
 * The message to show when opening or saving a SAS Content file fails.
 *
 * Complete, punctuated sentences — read by the person whose file did not open —
 * unlike the lower-case fragments {@link describeContentProblem} writes to the
 * log. The rule for what gets interpolated is `auth/messages.ts`': a value
 * reaches a message only when the user can act on it. A `ViyaError`'s `detail`
 * qualifies; its correlator and error code stay in the log.
 */
export function localiseContentProblem(problem: ContentProblem): string {
  switch (problem.code) {
    case "content-unreachable":
      return vscode.l10n.t(
        "Could not reach SAS Viya to open this file. Check that you can reach the deployment from this machine, and whether it needs a proxy.",
      );
    case "content-too-large":
      return vscode.l10n.t(
        "This file is too large to open in the editor (limit {0} MB). Open it in SAS Studio instead.",
        String(Math.floor(problem.limitBytes / (1024 * 1024))),
      );
    case "unauthorized":
      // Delegated, not duplicated — slice 1c already words every reading of a
      // 401, including "sign in again".
      return localiseAuthProblem(problem.problem);
    case "forbidden":
      return vscode.l10n.t(
        "SAS Viya did not permit this. Ask your SAS administrator whether your account may read or change this content.{0}",
        detailSuffix(problem.error.detail),
      );
    case "content-rejected":
      // The two statuses this write path can produce that mean something
      // specific to the user. 412/428: the optimistic-concurrency guard fired —
      // finding 6.2. 404: the file is gone. Everything else is a generic
      // refusal pointing at the log.
      if (problem.error.status === 412 || problem.error.status === 428) {
        return vscode.l10n.t(
          "This file changed on the server since you opened it. Close it and open it again to get the current version before saving your changes.",
        );
      }
      if (problem.error.status === 404) {
        return vscode.l10n.t(
          "This file no longer exists on the server. It may have been deleted or moved.",
        );
      }
      return vscode.l10n.t(
        "SAS Viya refused the request (HTTP {0}). See the Python on Viya log for details.{1}",
        String(problem.error.status),
        detailSuffix(problem.error.detail),
      );
    case "response-malformed":
      return vscode.l10n.t(
        "SAS Viya answered with something this extension could not read. See the Python on Viya log for details.",
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
 * stop when there is nothing to add. */
function detailSuffix(detail: string | undefined): string {
  return detail === undefined ? "" : ` ${detail}`;
}
