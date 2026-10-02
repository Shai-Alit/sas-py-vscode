// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The user-facing half of the SAS Server view's localisation seam:
 * `problems.ts` writes the log fragment, this says it to the user. The same
 * split as `src/data/messages.ts`, and an explicit `string` return with no
 * `default`, so a new `ServerProblem` fails to type-check until it is worded.
 */

import * as vscode from "vscode";

import { localiseComputeProblem } from "../compute/messages";
import { type ServerProblem } from "./problems";

/** A complete sentence for a tree node, an editor error or a notification. */
export function localiseServerProblem(problem: ServerProblem): string {
  switch (problem.code) {
    case "not-connected":
      return vscode.l10n.t(
        "Not connected to SAS Viya. Connect, and try again.",
      );
    case "path-not-found":
      // Upstream's two messages for a root that is not there, by who set it.
      if (problem.root?.setBy === "context") {
        return vscode.l10n.t(
          "The files cannot be accessed from the path specified in the context definition for the SAS Compute Server. Contact your SAS administrator.",
        );
      }
      if (problem.root?.setBy === "profile") {
        return vscode.l10n.t(
          'The files cannot be accessed from "{0}", the root folder set in your connection profile. Check fileNavigationCustomRootPath.',
          problem.path,
        );
      }
      return vscode.l10n.t(
        '"{0}" is not available on the SAS server. It may have been moved or deleted, or the server does not show it.',
        problem.path,
      );
    case "changed-on-server":
      return vscode.l10n.t(
        '"{0}" changed on the SAS server since you opened it. Copy your changes, reopen the file, and apply them again.',
        problem.path,
      );
    case "name-taken":
      return vscode.l10n.t(
        '"{0}" already exists on the SAS server. Choose another name.',
        problem.path,
      );
    case "invalid-name":
      return vscode.l10n.t(
        '"{0}" can\'t be used as a name. A name can\'t be empty, "." or "..", or contain "/".',
        problem.name,
      );
    case "invalid-move":
      return vscode.l10n.t(
        '"{0}" can\'t be moved into "{1}".',
        problem.path,
        problem.target,
      );
    case "left-empty":
      return vscode.l10n.t(
        '{0} An empty "{1}" was left on the SAS server. Delete it from the SAS Server view.',
        localiseServerProblem(problem.cause),
        problem.path,
      );
    case "too-large":
      return vscode.l10n.t(
        '"{0}" is too large to open in the editor (over {1} MB).',
        problem.path,
        String(Math.round(problem.limitBytes / (1024 * 1024))),
      );
    case "no-version":
      return vscode.l10n.t(
        'SAS Viya did not return a version tag for "{0}", so it cannot be saved safely. Reopen it from the SAS Server view and try again.',
        problem.path,
      );
    case "wrong-kind":
      return problem.expected === "file"
        ? vscode.l10n.t('"{0}" is a folder, not a file.', problem.path)
        : vscode.l10n.t('"{0}" is a file, not a folder.', problem.path);
    case "compute":
      return localiseComputeProblem(problem.problem);
  }
}
