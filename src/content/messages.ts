// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The user-facing half of the SAS Content localisation seam.
 *
 * `problems.ts` names what went wrong and writes the English fragment for the
 * log; this file says it in the user's language. The same split as
 * `src/compute/messages.ts`, down to the file name, and for the same reason:
 * the core loads in the unit tier, outside an extension host, and `l10n.t()`
 * lives on the `vscode` module.
 *
 * Adding a member to {@link ContentProblem} breaks the build here until it is
 * handled — explicit `string` return, no `default`, no fallback string.
 */

import * as vscode from "vscode";

import { localiseAuthProblem } from "../auth/messages";
import type { ContentProblem } from "./problems";

/**
 * The message to show when reading the SAS Content tree fails.
 *
 * Complete sentences, unlike `describeContentProblem`'s lower-case log
 * fragments. A `ViyaError`'s `detail` is interpolated where present — the
 * deployment's own sentence about what it refused — while the correlator and
 * error code stay in the log for support.
 */
export function localiseContentProblem(problem: ContentProblem): string {
  switch (problem.code) {
    case "content-unreachable":
      return vscode.l10n.t(
        "Could not reach SAS Viya to load SAS Content. Check that you can reach the deployment from this machine, and whether it needs a proxy. ({0})",
        problem.detail,
      );
    case "unauthorized":
      return localiseAuthProblem(problem.problem);
    case "forbidden":
      return vscode.l10n.t(
        "SAS Viya did not permit reading this content. Ask your SAS administrator about your access to this folder.{0}",
        detailSuffix(problem.error.detail),
      );
    case "content-rejected":
      return vscode.l10n.t(
        "SAS Viya could not return this content (HTTP {0}). It may have been moved or deleted. See the Python on Viya log for details.{1}",
        String(problem.error.status),
        detailSuffix(problem.error.detail),
      );
    case "response-malformed":
      return vscode.l10n.t(
        "SAS Viya answered with something this extension could not read while loading SAS Content. See the Python on Viya log for details.",
      );
    case "link-missing":
      return vscode.l10n.t(
        "SAS Viya did not offer a way to list this folder for your account. You may not have permission for it, or this deployment may not support it. See the Python on Viya log for details.",
      );
    case "foreign-link":
      return vscode.l10n.t(
        "SAS Viya sent a link pointing at another host, which was not followed. Please report this, with the Python on Viya log.",
      );
  }
}

/** A deployment's own sentence as a trailing clause, or nothing. The leading
 * space is inside the string so `{0}` sits flush against the full stop before
 * it when there is nothing to add. */
function detailSuffix(detail: string | undefined): string {
  return detail === undefined ? "" : ` ${detail}`;
}
