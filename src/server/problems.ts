// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What can go wrong in the SAS Server view, as codes, and the English
 * fragment each writes to the log.
 *
 * **This module must never import `vscode`.** `messages.ts` says the same
 * things to the user, in their language. The split `src/data/problems.ts`
 * makes, for the same reason.
 */

import {
  type ComputeProblem,
  describeComputeProblem,
} from "../compute/problems";
import { type ViyaError } from "../wire/viyaError";

export type ServerProblem =
  /** The profile holds no compute session in this window. The view never
   * starts one (ADR-0047, ADR-0027); its welcome offers Connect. */
  | { code: "not-connected" }
  /**
   * A `404` for a path while its session is still there: the path does not
   * exist, or the server will not show it (Finding 13.21 — both are `404`).
   * `root` is set when the path is the tree's root, so the message can say
   * which setting named it, as upstream does.
   */
  | {
      code: "path-not-found";
      path: string;
      error: ViyaError;
      root?: { readonly setBy: "profile" | "context" } | undefined;
    }
  /** A save whose `ETag` no longer matches: the file changed on the server
   * since it was opened (`412`, Finding 13.24). */
  | { code: "changed-on-server"; path: string; error: ViyaError }
  /** A create, rename or move onto a name the destination folder already
   * holds, as a file or a folder (`409`, Findings 13.24 and 13.31). */
  | { code: "name-taken"; path: string; error: ViyaError }
  /** A name this view will not send: empty, `.`, `..`, or holding `/`. */
  | { code: "invalid-name"; name: string }
  /** A move into the item's own folder, into itself, or below itself. The
   * server answers the last with a `404` naming no path (Finding 13.31). */
  | { code: "invalid-move"; path: string; target: string }
  /** An upload whose bytes failed after its empty file was created, and the
   * empty file could not be removed again. `cause` is why the bytes failed. */
  | { code: "left-empty"; path: string; cause: ServerProblem }
  /** A file larger than the cap: the editor's, or a transfer's. */
  | { code: "too-large"; path: string; size: number; limitBytes: number }
  /** A save of a file whose read carried no `ETag`, so it cannot be
   * conditional, or of a file never read in this window. */
  | { code: "no-version"; path: string }
  /** The path names a folder where a file was expected, or the reverse. */
  | { code: "wrong-kind"; path: string; expected: "file" | "folder" }
  /** Everything `src/compute/` already classifies: a transport failure, a
   * `401`/`403`, a gone session, a malformed response, a missing link. */
  | { code: "compute"; problem: ComputeProblem };

/** The English fragment for the log. Lower-case, no full stop, matching
 * `describeComputeProblem`. */
export function describeServerProblem(problem: ServerProblem): string {
  switch (problem.code) {
    case "not-connected":
      return "no active SAS Viya session for browsing the SAS server";
    case "path-not-found":
      return `"${problem.path}" is not available on the SAS server${problem.root === undefined ? "" : ` (the root set by the ${problem.root.setBy})`} (HTTP ${String(problem.error.status)})`;
    case "changed-on-server":
      return `"${problem.path}" changed on the SAS server since it was opened (HTTP ${String(problem.error.status)})`;
    case "name-taken":
      return `"${problem.path}" already exists on the SAS server (HTTP ${String(problem.error.status)})`;
    case "invalid-name":
      return `"${problem.name}" is not a name a file or folder can have`;
    case "invalid-move":
      return `"${problem.path}" cannot be moved into "${problem.target}"`;
    case "left-empty":
      return `${describeServerProblem(problem.cause)}; an empty "${problem.path}" was left on the SAS server`;
    case "too-large":
      return `"${problem.path}" is ${String(problem.size)} bytes, over the ${String(problem.limitBytes)}-byte limit`;
    case "no-version":
      return `"${problem.path}" has no version tag to save against`;
    case "wrong-kind":
      return `"${problem.path}" is not a ${problem.expected}`;
    case "compute":
      return describeComputeProblem(problem.problem);
  }
}
