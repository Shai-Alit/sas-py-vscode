// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * One file or folder on the compute server, as the SAS Server view holds it,
 * and the reader that builds one from the files API's JSON.
 *
 * **This module must never import `vscode`.**
 *
 * The shape is the files API's `application/vnd.sas.compute.file.properties`
 * (Findings 13.20 and 13.22): `name`, `path`, `isDirectory`, `readOnly`,
 * `size`, `modifiedTimeStamp` and `links`. Its `path` is the **parent**
 * folder, not the item's own path, so {@link readServerItem} joins the two.
 */

import { readLinks, type Link } from "../wire/links";
import { joinServerPath, normaliseServerPath } from "./path";

/** The relation on a folder that lists it. `GET`, a collection. */
export const DIRECTORY_MEMBERS_REL = "getDirectoryMembers";

/** The relation on a file that reads its bytes. `GET …/content`. */
export const FILE_CONTENT_REL = "getFile";

/** The relation on a file that writes its bytes. **`PUT` …/content**, despite
 * the name (Finding 13.22). */
export const FILE_WRITE_REL = "createFile";

/** The relation on a collection page that reads the next one. */
export const NEXT_REL = "next";

/** The relation on a session that reads its state. */
export const SESSION_STATE_REL = "state";

/** The relation that names a resource: a session's, whose `href`
 * `serverFilesHref` builds on (ADR-0047), and a compute context's, which
 * leads from its summary to its detail. */
export const SELF_REL = "self";

export interface ServerItem {
  readonly name: string;
  /** The item's own absolute server path. */
  readonly path: string;
  readonly isDirectory: boolean;
  readonly readOnly: boolean;
  /** Bytes. `undefined` when the server did not say. */
  readonly size: number | undefined;
  /** Milliseconds since the epoch. `undefined` when absent or unreadable. */
  readonly modifiedAt: number | undefined;
  readonly links: readonly Link[];
}

/**
 * A {@link ServerItem} from one properties representation, or `undefined`
 * when it is not one: no string `name`, no boolean `isDirectory`, or no
 * string `path` to place it in.
 *
 * `ownPath` overrides the joined path. The root's representation has `name:
 * ""` (Finding 13.20), and a root reached by a composed URL is already known
 * by path, so its caller passes that path rather than rebuild it.
 */
export function readServerItem(
  raw: unknown,
  ownPath?: string,
): ServerItem | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const { name, path, isDirectory } = record;
  if (typeof name !== "string" || typeof isDirectory !== "boolean") {
    return undefined;
  }
  let itemPath = ownPath;
  if (itemPath === undefined) {
    if (typeof path !== "string" || name === "") return undefined;
    itemPath = joinServerPath(normaliseServerPath(path), name);
  }
  return {
    name,
    path: normaliseServerPath(itemPath),
    isDirectory,
    readOnly: record.readOnly === true,
    size: typeof record.size === "number" ? record.size : undefined,
    modifiedAt: readTimestamp(record.modifiedTimeStamp),
    links: readLinks(raw),
  };
}

/** A `modifiedTimeStamp` (ISO 8601, Finding 13.22) as epoch milliseconds. */
function readTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? undefined : millis;
}

/**
 * Folders first, then files, each by name, the order upstream's
 * `sortedContentItems` gives. `localeCompare` with no locale, as upstream
 * calls it.
 */
export function sortServerItems(
  items: readonly ServerItem[],
): readonly ServerItem[] {
  return [...items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
