// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What can go wrong while browsing SAS libraries, as codes rather than prose.
 *
 * **This module must never import `vscode`.**
 *
 * Unlike `src/content/problems.ts` (a genuinely different service, Folders and
 * Files, with its own failure vocabulary), `src/data/` talks to the *same*
 * Compute service `src/compute/` already does — the `DataAccessApi` is a
 * different resource path on one session, not a different backend
 * (`docs/phases/phase-7.md`'s Plan section). So this file does not restate
 * `ComputeProblem`'s vocabulary; it wraps it (`code: "compute"`), the same way
 * `ContentProblem` wraps `AuthProblem` rather than re-diagnosing a 401 itself.
 * The two variants that *are* new here are new to this module specifically:
 * neither "no session" nor "session busy" is a wire failure at all — both are
 * decided before a request is ever sent.
 */

import {
  type ComputeProblem,
  describeComputeProblem,
} from "../compute/problems";

/**
 * A data-browsing failure.
 *
 * As in `compute/problems.ts` and `content/problems.ts`, adding a member
 * breaks the build in every renderer until it is handled — an exhaustive
 * `switch` with an explicit `string` return and no `default`.
 */
export type DataProblem =
  /**
   * The active profile holds no compute session in this window.
   *
   * [ADR-0027](../../docs/adr/0027-library-adapter-shape.md): the tree does
   * not trigger a session the way it never triggers an interactive sign-in —
   * starting one is starting a SAS process, not obtaining a token, so this is
   * a decision to surface rather than something `LibraryAdapter` should
   * cause. The `pythonOnViya.dataExplorer` view's own `viewsWelcome` content
   * is what actually invites the user to press Connect; this code is what
   * the tree logs instead of showing an empty list with no explanation.
   */
  | { code: "not-connected" }
  /**
   * The active profile's session has a submission running.
   *
   * Finding 7.3 (reconfirmed on two deployments and two cadences: Findings
   * 7.5/7.6/7.7) measured that a `DataAccessApi` read blocks at the SAS
   * kernel behind a running job rather than erroring or running concurrently
   * — so issuing one anyway would hang the tree, with no visible cause, for
   * the run's entire duration. `LibraryAdapter` checks
   * `ComputeSessionManager.isBusy` first and refuses instead, mirroring
   * `startSubmission`'s own "refuse rather than queue" precedent (finding 27)
   * — see ADR-0027.
   */
  | { code: "session-busy" }
  /**
   * `pythonOnViya.exportTableToCsv`'s own pre-flight check (`src/data/
   * csvExportCommand.ts`) found too little free space at the destination for
   * the estimated export size, and refused to start writing rather than run
   * out of disk space mid-stream. `estimatedBytes` is a rough projection from
   * a small sample page and the table's own `rowCount`, not an exact figure
   * — real CSV row width can vary — so this is a safety margin, not a
   * guarantee either way: a table that passes this check can still run out
   * if its later rows are unusually wide, which the ordinary per-write
   * failure path still catches.
   */
  | {
      code: "insufficient-disk-space";
      estimatedBytes: number;
      availableBytes: number;
    }
  /** Everything else — a transport failure, a 401/403, a session that has
   * gone away, a malformed response, a missing link relation — is exactly
   * what `src/compute/client.ts` and `src/compute/session.ts` already
   * classify. Delegated rather than re-diagnosed, the same reason
   * `ContentProblem`'s `unauthorized` variant carries an `AuthProblem`
   * instead of a second reading of a 401. */
  | { code: "compute"; problem: ComputeProblem };

/**
 * The English sentence for a log.
 *
 * Lower-case fragment, no trailing full stop — matching `describeComputeProblem`
 * and `describeContentProblem`, whose caller embeds these in a longer line.
 */
export function describeDataProblem(problem: DataProblem): string {
  switch (problem.code) {
    case "not-connected":
      return "no active SAS Viya session for browsing libraries";
    case "session-busy":
      return "the compute session is running Python and cannot be browsed right now";
    case "insufficient-disk-space":
      return `an estimated ${String(problem.estimatedBytes)} bytes will not fit in the ${String(problem.availableBytes)} bytes free at the destination`;
    case "compute":
      return describeComputeProblem(problem.problem);
  }
}
