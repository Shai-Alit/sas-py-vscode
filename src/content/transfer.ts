// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What a download from SAS Content to local disk will write (13a) — the
 * `vscode`-free half of `src/content/contentTransfer.ts`.
 *
 * {@link planDownload} walks the chosen item through the adapter's own folder
 * listing and returns every folder to create and every file to fetch, each as
 * a path of names relative to the folder the user picked. Nothing is written
 * here; the shell does the writing, so every decision about *what* is written
 * is unit-tested without a filesystem.
 *
 * Three kinds of member are left out and reported rather than failing the
 * whole download:
 *
 * - **Not a file.** A folder listing also carries `dataFlow` leaves
 *   (`LISTED_MEMBER_TYPES`), which have no bytes at `/files/files/{id}/content`.
 * - **A name that cannot be a local file name.** SAS Content refuses only `/`
 *   in a name, so a member can be called `a\b`, `..`, `CON`, or end in a dot.
 *   Written as-is, a separator or `..` would land outside the chosen folder,
 *   and the rest fail on Windows. {@link isSafeLocalName} applies the Windows
 *   rules on every platform, so a download behaves the same wherever it runs.
 *   Two siblings whose names differ only in case also collide on Windows and
 *   macOS, and SAS Content allows a file and a folder of the same name in one
 *   folder (Finding 6.6's clash is per type), so a second sibling with a name
 *   already taken is left out the same way.
 * - **A folder already listed.** A folder reached a second time, through a
 *   different member pointing at the same resource, is not walked again; its
 *   second path is reported, so the summary does not look complete while that
 *   part of the tree is missing.
 */

import { type ContentAdapter } from "./adapter";
import { type ContentFailure, type ContentResult } from "./client";
import {
  FILE_CONTENT_TYPE,
  isContainer,
  resourceHrefOf,
  typeNameOf,
  type ContentItem,
} from "./types";

/** One file a download fetches: where it goes, and the resource to read. */
export interface DownloadFile {
  /** Names from the chosen local folder down to the file, the file's last. */
  readonly path: readonly string[];
  /** The `/files/files/{id}` resource whose `…/content` holds the bytes. */
  readonly href: string;
}

/** Why a member was left out of a download. */
export type SkipReason =
  "not-a-file" | "unsafe-name" | "duplicate-name" | "already-listed";

/** One member left out of a download, for the summary and the log. */
export interface SkippedItem {
  /** Names from the chosen local folder down to the member, as SAS Content
   * spells them. */
  readonly path: readonly string[];
  readonly reason: SkipReason;
}

/** Everything a download will do, in order. */
export interface DownloadPlan {
  /** Folders to create, each before anything inside it. */
  readonly folders: readonly (readonly string[])[];
  readonly files: readonly DownloadFile[];
  readonly skipped: readonly SkippedItem[];
}

/** Windows' reserved device names, with or without an extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Characters no Windows file name may contain, `/` and `\` among them. */
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*]/;

/**
 * Whether `name` can be written as one local file or folder name on every
 * platform this extension runs on — no separator, not `.` or `..`, no
 * character or device name Windows refuses, no control character, and no
 * trailing dot or space (which Windows silently strips, so the file would
 * land under a different name).
 */
export function isSafeLocalName(name: string): boolean {
  if (name === "" || name === "." || name === "..") return false;
  if (FORBIDDEN_CHARACTERS.test(name)) return false;
  for (let i = 0; i < name.length; i += 1) {
    if (name.charCodeAt(i) < 0x20) return false;
  }
  if (name.endsWith(".") || name.endsWith(" ")) return false;
  return !RESERVED_NAME.test(name);
}

/**
 * Walk `item` — a file, or a folder and everything below it — into a
 * {@link DownloadPlan}. A folder's listing failing fails the whole plan, since
 * a download missing an unknown part of the tree is not what the user asked
 * for; the adapter's failure is returned unchanged.
 *
 * Each folder is listed once, keyed by its resource href, so a folder reached
 * twice (a favourite pointing at a folder the walk is already inside) is not
 * walked again, and its second path is reported as skipped.
 */
export async function planDownload(
  adapter: ContentAdapter,
  item: ContentItem,
  signal?: AbortSignal,
): Promise<ContentResult<DownloadPlan>> {
  const folders: (readonly string[])[] = [];
  const files: DownloadFile[] = [];
  const skipped: SkippedItem[] = [];
  const visited = new Set<string>();

  const visit = async (
    node: ContentItem,
    path: readonly string[],
  ): Promise<ContentFailure | undefined> => {
    if (isContainer(node)) {
      const href = resourceHrefOf(node);
      if (href !== undefined) {
        if (visited.has(href)) {
          skipped.push({ path, reason: "already-listed" });
          return undefined;
        }
        visited.add(href);
      }
      folders.push(path);
      const listing = await adapter.getChildItems(node, signal);
      if (!listing.ok) return listing;
      const taken = new Set<string>();
      for (const child of listing.value) {
        const childPath = [...path, child.name];
        if (!isSafeLocalName(child.name)) {
          skipped.push({ path: childPath, reason: "unsafe-name" });
          continue;
        }
        const key = child.name.toLowerCase();
        if (taken.has(key)) {
          skipped.push({ path: childPath, reason: "duplicate-name" });
          continue;
        }
        taken.add(key);
        const failure = await visit(child, childPath);
        if (failure !== undefined) return failure;
      }
      return undefined;
    }

    const href = resourceHrefOf(node);
    if (typeNameOf(node) !== FILE_CONTENT_TYPE || href === undefined) {
      skipped.push({ path, reason: "not-a-file" });
      return undefined;
    }
    files.push({ path, href });
    return undefined;
  };

  if (!isSafeLocalName(item.name)) {
    return {
      ok: true,
      value: {
        folders: [],
        files: [],
        skipped: [{ path: [item.name], reason: "unsafe-name" }],
      },
    };
  }
  const failure = await visit(item, [item.name]);
  if (failure !== undefined) return failure;
  return { ok: true, value: { folders, files, skipped } };
}
