// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Whether one item on the compute server can be moved into a folder, decided
 * before anything is sent — the SAS Server view's counterpart to
 * `src/content/contentMove.ts`.
 *
 * **This module must never import `vscode`.**
 *
 * Checked here rather than left to the server because the server's answers
 * are poor: a folder moved below itself is a `404` naming no path, with a
 * `400` inside (Finding 13.31), and a create in the read-only root is a
 * `404` for a doubled `//` path (Finding 13.34). A move into the folder the
 * item is already in would send a `PUT` that changes nothing.
 */

import { isWithinServerPath, parentServerPath } from "./path";
import { type ServerItem } from "./types";

export type ServerMoveObjection =
  /** The target is a file. */
  | "target-not-a-folder"
  /** The server marks the target folder `readOnly`. */
  | "target-read-only"
  /** The item is already in the target folder. */
  | "same-folder"
  /** The target is the item itself, or below it. */
  | "into-itself";

/** Why `item` cannot be moved into `target`, or `undefined` when it can. */
export function serverMoveObjection(
  item: Pick<ServerItem, "path">,
  target: Pick<ServerItem, "path" | "isDirectory" | "readOnly">,
): ServerMoveObjection | undefined {
  if (!target.isDirectory) return "target-not-a-folder";
  if (isWithinServerPath(target.path, item.path)) return "into-itself";
  if (parentServerPath(item.path) === target.path) return "same-folder";
  if (target.readOnly) return "target-read-only";
  return undefined;
}

/** Whether a name can be sent for a create or a rename: not empty, not `.`
 * or `..`, and no `/` or NUL. Everything else is the server's to refuse. */
export function isValidServerName(name: string): boolean {
  return (
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\0")
  );
}
