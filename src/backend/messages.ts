// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The user-facing half of the execution-seam localisation split.
 *
 * `problems.ts` names what went wrong as a code and writes the English
 * fragment that goes to the log; this file says it in the user's language.
 * Same split as `src/compute/messages.ts` and `src/auth/messages.ts`, and for
 * the same reason: `BackendProblem` has to load in the unit tier, outside an
 * extension host, so `l10n.t()` — which lives on the `vscode` module — cannot
 * live next to it.
 *
 * `problems.ts`'s own doc comment names where this was deferred to: "The
 * user-facing half is rendered elsewhere… in the slice that first shows one
 * of these to a person (3d)." This is that slice, and this is that file.
 *
 * `detail` on `transfer-failed`, `runtime-unavailable`, `backend-gone` and
 * `backend-failed` is deliberately **not** interpolated into the sentence
 * shown here, unlike `compute/messages.ts`'s `compute-unreachable` — it is
 * already `describeComputeProblem`'s own log fragment (`procPython.ts`'s
 * `translate()` builds it that way), not a deployment's own sentence about
 * what it refused, and dumping an internal fragment into a notification reads
 * as a stack trace rather than as an answer. It stays in the log, which
 * every message here points readers at.
 */

import * as vscode from "vscode";

import type { BackendProblem } from "./problems";

/**
 * The message to show the user when a run, a cancel or a reset fails at the
 * execution seam.
 *
 * Complete sentences, capitalised and punctuated, unlike `describeBackendProblem`'s
 * lower-case log fragments. Adding a member to `BackendProblem` breaks this
 * function's exhaustive `switch` until it is handled here too.
 */
export function localiseBackendProblem(problem: BackendProblem): string {
  switch (problem.code) {
    case "not-connected":
      return vscode.l10n.t(
        "Not connected to SAS Viya. Connect, or sign in, and try again.",
      );
    case "busy":
      // `running` is an id, not a file name — a run known by name is 3d-ii's
      // job (the result panel can say which document a handle came from);
      // here it is enough to say that something is already running.
      return vscode.l10n.t(
        "A Python program is already running in this session. Wait for it to finish, or cancel it, before starting another.",
      );
    case "unsupported":
      return vscode.l10n.t(
        "This backend cannot {0} right now. See the Python on Viya log for details.",
        problem.feature,
      );
    case "transfer-failed":
      return vscode.l10n.t(
        "The program could not be sent to SAS Viya, so nothing ran. See the Python on Viya log for details.",
      );
    case "runtime-unavailable":
      return vscode.l10n.t(
        "No Python runtime is available in this SAS Viya session. See the Python on Viya log for details.",
      );
    case "backend-gone":
      return vscode.l10n.t(
        "The SAS Viya session ended. Connect again and re-run.",
      );
    case "cancelled":
      return vscode.l10n.t("Cancelled.");
    case "backend-failed":
      return vscode.l10n.t(
        "Running on SAS Viya failed. See the Python on Viya log for details.",
      );
  }
}
