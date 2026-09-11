// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The user-facing half of the data-browsing localisation seam.
 *
 * `problems.ts` names what went wrong as a code and writes the English
 * fragment for the log ({@link describeDataProblem}); this file says it in
 * the user's language, for the one place a data-browsing failure reaches the
 * user directly — the data viewer panel (`src/data/dataViewerPanel.ts`), when
 * opening a table or requesting a page of its rows fails. The read-only tree
 * still only logs. Same split as `src/content/messages.ts` /
 * `src/compute/messages.ts` / `src/auth/messages.ts`, down to the file name,
 * and for the same reason: `problems.ts` must stay `vscode`-free (it loads in
 * the unit tier, outside an extension host) and `l10n.t()` lives on the
 * `vscode` module.
 *
 * Adding a member to `DataProblem` breaks the build here until it is
 * handled — an explicit `string` return, no `default`, so a missing case
 * fails to type-check rather than shipping an English string to a translated
 * user.
 *
 * **Caught during Phase 7b's PR write-up, 2026-09-10**: `dataViewerPanel.ts`
 * had been passing `describeDataProblem`'s own log fragment straight into the
 * `FailureMessage`/`RowsErrorMessage` the webview renders — the exact
 * busy-session text `manual-test-pass.md` §11 exercises — with no `l10n.t()`
 * anywhere in the path, unlike every other panel in this project. This file
 * closes that gap; `dataViewerPanel.ts` now calls {@link localiseDataProblem}
 * for both message fields instead.
 */

import * as vscode from "vscode";

import { localiseComputeProblem } from "../compute/messages";
import { type DataProblem } from "./problems";

/**
 * The message to show when opening a table, or requesting a page of its
 * rows, fails in the data viewer panel.
 *
 * Complete, punctuated sentences — read by the person whose table did not
 * open — unlike the lower-case fragments {@link describeDataProblem} writes
 * to the log.
 */
export function localiseDataProblem(problem: DataProblem): string {
  switch (problem.code) {
    case "not-connected":
      return vscode.l10n.t(
        "Not connected to SAS Viya. Connect, or sign in, and try again.",
      );
    case "session-busy":
      return vscode.l10n.t(
        "A Python program is running in this session, so it cannot be browsed right now. Wait for it to finish, or cancel it, then try again.",
      );
    case "insufficient-disk-space":
      return vscode.l10n.t(
        "This table is estimated at about {0}, but only about {1} is free at the destination. Choose a location with more free space and try again.",
        formatBytes(problem.estimatedBytes),
        formatBytes(problem.availableBytes),
      );
    case "compute":
      // Delegated, not duplicated — `compute/messages.ts` already words
      // every reading of a transport failure, a 401/403, a gone session, and
      // so on, the same way `localiseContentProblem`'s `unauthorized` case
      // delegates to `localiseAuthProblem` rather than re-wording a 401.
      return localiseComputeProblem(problem.problem);
  }
}

/** A byte count as a human-scale string (`"12.3 MB"`) — decimal (1000-based)
 * units, matching how VS Code's own file-size UI and most desktop file
 * managers report free disk space, rather than the binary (1024-based) KiB/
 * MiB/GiB an `insufficient-disk-space` reader would otherwise have to
 * mentally convert. */
function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  // `unitIndex` never leaves `[0, units.length - 1]` — the loop guard above
  // keeps it there — so this is always a real element, not the `undefined`
  // a bare index type would otherwise carry.
  const unit: string = units[unitIndex] ?? "bytes";
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${unit}`;
}
