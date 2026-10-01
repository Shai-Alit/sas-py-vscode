// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What a Copy, then Paste, in the SAS Content tree does (13b) — the
 * `vscode`-free half of `src/content/contentCopy.ts`.
 *
 * **This module must never import `vscode`.**
 *
 * A file is copied on the server, in one call ({@link ContentAdapter.copyFile},
 * Finding 13.9). The Folders service has no copy (Finding 13.10), so a folder
 * is copied here: the whole source tree is listed first, then a new folder
 * is made for each folder and each file is copied into its new folder. The
 * listing finishes before anything is created, so pasting a folder into
 * itself or into one of its own sub-folders copies the tree as it was, and
 * ends.
 *
 * The copy's name is the source's own when the target folder has nothing of
 * that name, and otherwise the first free `{base}_Copy{n}{ext}`, upstream
 * `vscode-sas-extension`'s pattern ({@link freeCopyName}). Names inside a
 * copied folder are kept, since the new folder starts empty. The name can
 * be taken between that listing and the call that uses it — by a second
 * Paste of the same copy, or by anyone else — so a failed call there is
 * retried once under the next free name when the target now has its name.
 *
 * Two kinds of member are left out and reported rather than failing the
 * whole copy, as a download leaves them out (`transfer.ts`):
 *
 * - **Not a file.** A `dataFlow` leaf is listed but has no file resource to
 *   copy. Members the listing filters out altogether (reports, jobs) never
 *   reach the copy, so they are neither copied nor counted.
 * - **A folder already listed.** A folder reached a second time is not
 *   walked again; its second path is reported.
 *
 * Every file is attempted even when an earlier one fails. A listing that
 * fails, or a folder that cannot be created, stops the copy there, since
 * what would follow has nowhere to go. A cancel stops before the next call.
 */

import { type ContentAdapter } from "./adapter";
import { type ContentFailure, type ContentResult } from "./client";
import { canReceiveMembers } from "./contentMove";
import {
  FILE_CONTENT_TYPE,
  isContainer,
  resourceHrefOf,
  typeNameOf,
  type ContentItem,
} from "./types";

/** Whether `item` can be copied at all: a folder, or a file with a resource
 * address. A data flow cannot. */
export function isCopyable(item: ContentItem): boolean {
  if (isContainer(item)) return true;
  return (
    typeNameOf(item) === FILE_CONTENT_TYPE && resourceHrefOf(item) !== undefined
  );
}

/**
 * Why a paste of a copied item was refused.
 *
 * - `not-a-member` — the item is not an ordinary member record (a delegate,
 *   a top-level folder, a favourite reference), the same set Cut refuses.
 * - `not-copyable` — not a folder or a file ({@link isCopyable}).
 * - `in-recycle-bin` — either side is in the Recycle Bin.
 * - `target-not-a-folder` — the target cannot take members
 *   (`canReceiveMembers`).
 *
 * Unlike a move, pasting into the item's own folder, or a folder into itself,
 * is not refused: the copy takes a free name, and the tree is listed before
 * anything is made.
 */
export type CopyObjection =
  "not-a-member" | "not-copyable" | "in-recycle-bin" | "target-not-a-folder";

/** `undefined` when `item` may be copied into `target`, otherwise why not. */
export function copyObjection(
  item: ContentItem,
  target: ContentItem,
): CopyObjection | undefined {
  if (item.type !== "child") return "not-a-member";
  if (item.inRecycleBin === true || target.inRecycleBin === true) {
    return "in-recycle-bin";
  }
  if (!isCopyable(item)) return "not-copyable";
  if (!canReceiveMembers(target)) return "target-not-a-folder";
  return undefined;
}

/**
 * `name`, or the first `{base}_Copy{n}{ext}` (n from 1) not in `taken`. A
 * file's extension, from its last `.` after the first character, stays at
 * the end; a folder's name is not split. Names are compared ignoring case,
 * so a name is only chosen if it is free whether or not the deployment
 * tells names apart by case.
 */
export function freeCopyName(
  name: string,
  folder: boolean,
  taken: Iterable<string>,
): string {
  const used = new Set<string>();
  for (const sibling of taken) used.add(sibling.toLowerCase());
  if (!used.has(name.toLowerCase())) return name;

  const dot = folder ? -1 : name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const numbered = (n: number) => `${base}_Copy${String(n)}${extension}`;
  let n = 1;
  while (used.has(numbered(n).toLowerCase())) n += 1;
  return numbered(n);
}

/** Why a member was left out of a copy. */
export type CopySkipReason = "not-a-file" | "already-listed";

/** One member left out, or one call that failed, with where it sits: names
 * from the copy's own (new) name down. */
export interface CopySkipped {
  readonly path: readonly string[];
  readonly reason: CopySkipReason;
}

export interface CopyFailure {
  readonly path: readonly string[];
  readonly failure: ContentFailure;
}

/** What a copy did. */
export interface CopyOutcome {
  /** The copy's name in the target folder. */
  readonly name: string;
  /** The copy's resource address — the new file, or the new top folder —
   * once it exists. `undefined` when nothing was created. */
  readonly copyHref: string | undefined;
  /** Files the copy set out to copy, once the source was listed. */
  readonly total: number;
  readonly copied: number;
  /** Files whose copy failed; the copy went on past each. */
  readonly failures: readonly CopyFailure[];
  /** The listing or folder creation that failed and stopped the copy. */
  readonly stopped: CopyFailure | undefined;
  readonly skipped: readonly CopySkipped[];
  readonly cancelled: boolean;
}

/** A listed folder: the folders and files to make inside its copy. */
interface CopyTree {
  readonly folders: readonly CopySubfolder[];
  readonly files: readonly ContentItem[];
}

interface CopySubfolder extends CopyTree {
  readonly item: ContentItem;
}

/** Told before each file is copied: its path, its index and the total. */
export type CopyProgress = (
  path: readonly string[],
  index: number,
  total: number,
) => void;

/**
 * Copy `item` into `target`. Lists `target` to choose a free name, lists the
 * source tree when `item` is a folder, then creates and copies. Never throws
 * for a failed call; every outcome is in the {@link CopyOutcome}.
 */
export async function copyItem(
  adapter: ContentAdapter,
  item: ContentItem,
  target: ContentItem,
  signal: AbortSignal,
  onFile?: CopyProgress,
): Promise<CopyOutcome> {
  const folder = isContainer(item);
  let name = item.name;
  let copyHref: string | undefined;
  let total = 0;
  let copied = 0;
  const failures: CopyFailure[] = [];
  const skipped: CopySkipped[] = [];
  const outcome = (
    end: { stopped?: CopyFailure; cancelled?: boolean } = {},
  ): CopyOutcome => ({
    name,
    copyHref,
    total,
    copied,
    failures,
    stopped: end.stopped,
    skipped,
    cancelled: end.cancelled ?? false,
  });
  // A failed call ends the copy as cancelled when the signal is why it
  // failed, and otherwise as stopped at `path`.
  const halt = (path: readonly string[], failure: ContentFailure) =>
    aborted(signal)
      ? outcome({ cancelled: true })
      : outcome({ stopped: { path, failure } });

  if (aborted(signal)) return outcome({ cancelled: true });
  const siblings = await adapter.getChildItems(target, signal);
  if (!siblings.ok) return halt([item.name], siblings);
  name = freeCopyName(
    item.name,
    folder,
    siblings.value.map((sibling) => sibling.name),
  );

  // Make the copy's own file or folder under `name`. If the service refuses
  // it, list the target again; if the name is now taken there, try once
  // more under the next free one. A taken name is refused `409` by a file
  // copy (Finding 13.9) and by a folder create, even one racing another
  // (Finding 13.11), or by the name check a create runs first (finding
  // 6.6). The listing decides rather than the refusal, since the name check
  // also refuses names for other reasons. Only a refusal is retried — a
  // call with no answer, or a `2xx` that could not be read, may have made
  // the copy already. Otherwise, or if the re-listing fails, the first
  // call's own failure is reported.
  const place = async <T>(
    attempt: (as: string) => Promise<ContentResult<T>>,
  ): Promise<ContentResult<T>> => {
    const first = await attempt(name);
    if (first.ok || aborted(signal) || !refused(first)) return first;
    const fresh = await adapter.getChildItems(target, signal);
    if (!fresh.ok) return first;
    const taken = fresh.value.map((sibling) => sibling.name);
    const lower = name.toLowerCase();
    if (!taken.some((other) => other.toLowerCase() === lower)) return first;
    name = freeCopyName(item.name, folder, taken);
    return await attempt(name);
  };

  if (!folder) {
    total = 1;
    if (aborted(signal)) return outcome({ cancelled: true });
    onFile?.([name], 0, 1);
    const result = await place((as) =>
      adapter.copyFile(item, target, as, signal),
    );
    if (result.ok) {
      copyHref = result.value;
      copied = 1;
      return outcome();
    }
    if (aborted(signal)) return outcome({ cancelled: true });
    failures.push({ path: [name], failure: result });
    return outcome();
  }

  // List the whole source before creating anything.
  const visited = new Set<string>();
  const rootHref = resourceHrefOf(item);
  if (rootHref !== undefined) visited.add(rootHref);
  const list = async (
    node: ContentItem,
    path: readonly string[],
  ): Promise<CopyTree | CopyFailure> => {
    const listing = await adapter.getChildItems(node, signal);
    if (!listing.ok) return { path, failure: listing };
    const folders: CopySubfolder[] = [];
    const files: ContentItem[] = [];
    for (const child of listing.value) {
      const childPath = [...path, child.name];
      if (isContainer(child)) {
        // Every listed folder member carries `uri` (see `resourceHrefOf`).
        const href = resourceHrefOf(child);
        if (href !== undefined) {
          if (visited.has(href)) {
            skipped.push({ path: childPath, reason: "already-listed" });
            continue;
          }
          visited.add(href);
        }
        const inner = await list(child, childPath);
        if ("failure" in inner) return inner;
        folders.push({ item: child, ...inner });
      } else if (isCopyable(child)) {
        files.push(child);
      } else {
        skipped.push({ path: childPath, reason: "not-a-file" });
      }
    }
    total += files.length;
    return { folders, files };
  };
  const listedAs = name;
  const tree = await list(item, [name]);
  if ("failure" in tree) {
    // Nothing was created, so nothing was left out or set out to be copied.
    skipped.length = 0;
    total = 0;
    return halt(tree.path, tree.failure);
  }

  if (aborted(signal)) return outcome({ cancelled: true });
  const root = await place((as) => adapter.createFolder(target, as, signal));
  if (!root.ok) return halt([name], root);
  copyHref = resourceHrefOf(root.value);
  if (name !== listedAs) {
    // The retry renamed the copy after the listing recorded its skips.
    skipped.splice(
      0,
      skipped.length,
      ...skipped.map((skip) => ({
        ...skip,
        path: [name, ...skip.path.slice(1)],
      })),
    );
  }

  let index = 0;
  const fill = async (
    into: ContentItem,
    node: CopyTree,
    path: readonly string[],
  ): Promise<CopyOutcome | undefined> => {
    for (const file of node.files) {
      if (aborted(signal)) return outcome({ cancelled: true });
      const filePath = [...path, file.name];
      onFile?.(filePath, index, total);
      index += 1;
      const result = await adapter.copyFile(file, into, file.name, signal);
      if (result.ok) {
        copied += 1;
      } else if (aborted(signal)) {
        return outcome({ cancelled: true });
      } else {
        failures.push({ path: filePath, failure: result });
      }
    }
    for (const sub of node.folders) {
      if (aborted(signal)) return outcome({ cancelled: true });
      const subPath = [...path, sub.item.name];
      const made = await adapter.createFolder(into, sub.item.name, signal);
      if (!made.ok) return halt(subPath, made);
      const end = await fill(made.value, sub, subPath);
      if (end !== undefined) return end;
    }
    return undefined;
  };
  return (await fill(root.value, tree, [name])) ?? outcome();
}

/** Whether the service answered `failure` with a refusal, so nothing was
 * made: an HTTP error, or the name check's `valid:false` (finding 6.6). */
function refused(failure: ContentFailure): boolean {
  const { code } = failure.problem;
  return code === "content-rejected" || code === "content-name-rejected";
}

/** `signal.aborted`, read through a call so the compiler does not carry a
 * narrowing from one check across the `await` that can change it — the
 * same helper `contentTransfer.ts` keeps. */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
