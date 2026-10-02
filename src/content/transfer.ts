// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What a download to local disk will write — the `vscode`-free half of
 * `src/content/contentTransfer.ts`. Written for SAS Content (13a), and made
 * generic over a {@link DownloadTree} in 13p-ii so the SAS Server view plans
 * its downloads the same way (`src/server/transfer.ts`).
 *
 * {@link planTreeDownload} walks the chosen item through the tree's own
 * folder listing and returns every folder to create and every file to fetch,
 * each as a path of names relative to the folder the user picked. Nothing is
 * written here; the shell does the writing, so every decision about *what* is
 * written is unit-tested without a filesystem. {@link planDownload} is SAS
 * Content's tree.
 *
 * Four kinds of member are left out and reported rather than failing the
 * whole download, and a fifth case is reported the same way:
 *
 * - **Not a file.** A folder listing also carries `dataFlow` leaves
 *   (`LISTED_MEMBER_TYPES`), which have no bytes at `/files/files/{id}/content`.
 *   Members the listing filters out altogether (reports, jobs) never reach
 *   the plan, so they are neither downloaded nor counted.
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
 * - **A folder too deep.** Only when the tree sets
 *   {@link DownloadTree.maxDepth}: the SAS Server view does, since a symbolic
 *   link can loop a folder back on itself and its listing does not say which
 *   folders are links. SAS Content has no links, and sets none.
 * - **A folder listed only in part.** When a tree's listing says it stopped
 *   short (the SAS Server view's page limit), what was listed is downloaded
 *   and the folder itself is reported, so the summary does not look complete
 *   while an unknown part of that folder is missing.
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

/** One file a download fetches: where it goes, and what to read it from. */
export interface DownloadFile<S = string> {
  /** Names from the chosen local folder down to the file, the file's last. */
  readonly path: readonly string[];
  /** What the tree reads the bytes from: for SAS Content, the
   * `/files/files/{id}` resource whose `…/content` holds them. */
  readonly source: S;
}

/** Why a member was left out of a download. */
export type SkipReason =
  | "not-a-file"
  | "unsafe-name"
  | "duplicate-name"
  | "already-listed"
  | "too-deep"
  | "listing-truncated";

/** One member left out of a download, for the summary and the log. */
export interface SkippedItem {
  /** Names from the chosen local folder down to the member, as the server
   * spells them. */
  readonly path: readonly string[];
  readonly reason: SkipReason;
}

/** Everything a download will do, in order. */
export interface DownloadPlan<S = string> {
  /** Folders to create, each before anything inside it. */
  readonly folders: readonly (readonly string[])[];
  readonly files: readonly DownloadFile<S>[];
  readonly skipped: readonly SkippedItem[];
}

/** A failure a tree's listing returns: anything with `ok: false`. */
export interface TreeFailure {
  readonly ok: false;
}

/** What {@link planTreeDownload} needs from a view's tree. `I` is an item,
 * `S` what a file's bytes are read from, `F` a failed listing. */
export interface DownloadTree<I, S, F extends TreeFailure> {
  nameOf(item: I): string;
  isFolder(item: I): boolean;
  /** A folder's identity, so one reached twice is listed once, or
   * `undefined` when it has none. */
  folderKey(item: I): string | undefined;
  /** What a file's bytes are read from, or `undefined` when the item is not
   * a file that can be downloaded. */
  fileSource(item: I): S | undefined;
  listChildren(
    folder: I,
    signal: AbortSignal | undefined,
  ): Promise<
    | {
        readonly ok: true;
        readonly value: readonly I[];
        /** The listing stopped with more members still unread. */
        readonly truncated?: boolean;
      }
    | F
  >;
  /** The most names a folder's path may have; a folder deeper than this is
   * left out as `too-deep`. The chosen item counts as one. No limit when
   * unset. */
  readonly maxDepth?: number | undefined;
}

/** Windows' reserved device names, with or without an extension. `COM` and
 * `LPT` take a superscript `¹`, `²` or `³` as well as a digit. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

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
 * Whether `item` can be downloaded at all: a folder, or a file with a resource
 * address. Anything else, such as a data flow chosen on its own, would plan
 * nothing but its own skip, so the download command refuses it up front.
 */
export function isDownloadable(item: ContentItem): boolean {
  if (isContainer(item)) return true;
  return (
    typeNameOf(item) === FILE_CONTENT_TYPE && resourceHrefOf(item) !== undefined
  );
}

/**
 * Walk `item` — a file, or a folder and everything below it — into a
 * {@link DownloadPlan}. A folder's listing failing fails the whole plan, since
 * a download missing an unknown part of the tree is not what the user asked
 * for; the tree's failure is returned unchanged.
 *
 * Each folder is listed once, keyed by {@link DownloadTree.folderKey}, so a
 * folder reached twice (a SAS Content favourite pointing at a folder the walk
 * is already inside) is not walked again, and its second path is reported as
 * skipped.
 */
export async function planTreeDownload<I, S, F extends TreeFailure>(
  tree: DownloadTree<I, S, F>,
  item: I,
  signal?: AbortSignal,
): Promise<{ readonly ok: true; readonly value: DownloadPlan<S> } | F> {
  const folders: (readonly string[])[] = [];
  const files: DownloadFile<S>[] = [];
  const skipped: SkippedItem[] = [];
  const visited = new Set<string>();

  const visit = async (
    node: I,
    path: readonly string[],
  ): Promise<F | undefined> => {
    if (tree.isFolder(node)) {
      if (tree.maxDepth !== undefined && path.length > tree.maxDepth) {
        skipped.push({ path, reason: "too-deep" });
        return undefined;
      }
      const key = tree.folderKey(node);
      // A folder with no key is listed unkeyed.
      if (key !== undefined) {
        if (visited.has(key)) {
          skipped.push({ path, reason: "already-listed" });
          return undefined;
        }
        visited.add(key);
      }
      folders.push(path);
      const listing = await tree.listChildren(node, signal);
      if (!listing.ok) return listing;
      const taken = new Set<string>();
      for (const child of listing.value) {
        const name = tree.nameOf(child);
        const childPath = [...path, name];
        if (!isSafeLocalName(name)) {
          skipped.push({ path: childPath, reason: "unsafe-name" });
          continue;
        }
        const lower = name.toLowerCase();
        if (taken.has(lower)) {
          skipped.push({ path: childPath, reason: "duplicate-name" });
          continue;
        }
        taken.add(lower);
        const failure = await visit(child, childPath);
        if (failure !== undefined) return failure;
      }
      if (listing.truncated === true) {
        skipped.push({ path, reason: "listing-truncated" });
      }
      return undefined;
    }

    const source = tree.fileSource(node);
    if (source === undefined) {
      skipped.push({ path, reason: "not-a-file" });
      return undefined;
    }
    files.push({ path, source });
    return undefined;
  };

  const name = tree.nameOf(item);
  if (!isSafeLocalName(name)) {
    return {
      ok: true,
      value: {
        folders: [],
        files: [],
        skipped: [{ path: [name], reason: "unsafe-name" }],
      },
    };
  }
  const failure = await visit(item, [name]);
  if (failure !== undefined) return failure;
  return { ok: true, value: { folders, files, skipped } };
}

/**
 * SAS Content's {@link DownloadTree}. A folder is keyed by its resource href:
 * a listed member carries `uri`, and a delegate or root folder its `self`
 * link (see `resourceHrefOf`). A file is read from the same href; a member
 * that is not a file, such as a data flow, has nothing to read.
 */
export function contentDownloadTree(
  adapter: ContentAdapter,
): DownloadTree<ContentItem, string, ContentFailure> {
  return {
    nameOf: (item) => item.name,
    isFolder: isContainer,
    folderKey: resourceHrefOf,
    fileSource: (item) =>
      typeNameOf(item) === FILE_CONTENT_TYPE ? resourceHrefOf(item) : undefined,
    listChildren: (folder, signal) => adapter.getChildItems(folder, signal),
  };
}

/** {@link planTreeDownload} over {@link contentDownloadTree}. */
export async function planDownload(
  adapter: ContentAdapter,
  item: ContentItem,
  signal?: AbortSignal,
): Promise<ContentResult<DownloadPlan>> {
  return await planTreeDownload(contentDownloadTree(adapter), item, signal);
}
