// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The SAS Content tree's own vocabulary: what a content item is, which link
 * relations the read path follows, and which of the Folders service's `type`
 * values name something the tree can descend into.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: `client/src/components/ContentNavigator/types.ts` and
 * `const.ts` in sassoftware/vscode-sas-extension (Apache-2.0). No code was
 * copied. Upstream's `ContentItem` carries a dozen fields the tree data
 * provider infers (`vscUri`, `fileStat`, `contextValue`, `permission`, …);
 * those are VS Code concerns and are re-derived in `src/content/contentTree.ts`
 * from the small, service-shaped item this file describes.
 *
 * ## The three shapes one `ContentItem` covers
 *
 * A single item type spans three representations the Folders service returns,
 * and {@link isContainer} has to read all three (findings 83–85, `verde`,
 * 2026-09-09):
 *
 * - **A delegate folder** — `GET /folders/folders/@myFolder` and friends.
 *   `type` is `myFolder` / `favoritesFolder` / `trashFolder`; there is no
 *   `contentType`, and no `uri` field (its address is the `self` link).
 * - **A root folder** — an item of the `isNull(parent)` listing the SAS
 *   Content pseudo-root renders. `type` is `folder`; `contentType` and `uri`
 *   are **absent** (finding 84), so the `self` link is again the only address.
 * - **A member** — an entry of a folder's `members` collection. `type` is
 *   always `"child"`; `contentType` is `folder` or `file` and is what actually
 *   says whether the tree can descend; `uri` points at the underlying resource
 *   (`/folders/folders/{id}` or `/files/files/{id}`).
 */

import { readLinks, type Link } from "../wire/links";

/**
 * One SAS Content item, reduced to what the read-only tree reads.
 *
 * Everything past `links` is optional because the three representations above
 * disagree about which fields are present — a delegate folder has no `uri`, a
 * member has no `memberCount`, a root-listing item has neither `uri` nor
 * `contentType`. `id` and `name` are the two every representation carries.
 */
export interface ContentItem {
  /** The Folders/Files service id. Stable; used to key a tree node. */
  readonly id: string;
  readonly name: string;
  /**
   * The service `type`. `folder` / `myFolder` / `favoritesFolder` /
   * `trashFolder` for a folder-shaped thing read directly; `"child"` for a
   * member record, where {@link ContentItem.contentType} carries the real
   * kind. `RootFolder` is this extension's own synthetic value for the SAS
   * Content pseudo-root — see {@link SAS_CONTENT_ROOT}.
   */
  readonly type?: string | undefined;
  /**
   * A member record's underlying kind — `folder` or `file` (finding 85). Only
   * a member (`type: "child"`) carries it; absent on every folder read
   * directly.
   */
  readonly contentType?: string | undefined;
  /**
   * The underlying resource's address, when the representation states one. A
   * member carries it (`/folders/folders/{id}` or `/files/files/{id}`); a
   * delegate or root-listing folder does not (finding 84), and the tree falls
   * back to the `self` link — see {@link resourceHrefOf}.
   */
  readonly uri?: string | undefined;
  /** The Folders service's own count of members. Not read for any UI
   * decision — finding 80 recorded it disagreeing with the filtered
   * collection — kept only so a future slice need not re-add it. */
  readonly memberCount?: number | undefined;
  /** The hypermedia links, already narrowed by {@link readLinks}. */
  readonly links: readonly Link[];
}

/** `GET` a folder's own representation, or a member's `self`. */
export const SELF_REL = "self";

/** `GET` a folder's member collection. Present on delegate and root-listing
 * folders; **absent** on a folder *member* record (finding 85), where the
 * tree composes `${uri}/members` instead. */
export const MEMBERS_REL = "members";

/**
 * The four delegate folders the SAS Content tree shows at its top level, in
 * display order (matching upstream's `SAS_CONTENT_ROOT_FOLDERS`).
 *
 * `@myFavorites`, `@myFolder` and `@myRecycleBin` each resolve with a
 * `GET /folders/folders/@name` (finding 83). `@sasRoot` does **not** — it is a
 * synthetic node standing for "every folder with no parent", rendered from
 * {@link SAS_CONTENT_ROOT} and expanded with an `isNull(parent)` query
 * (finding 84).
 */
export const DELEGATE_FOLDERS = [
  "@myFavorites",
  "@myFolder",
  "@sasRoot",
  "@myRecycleBin",
] as const;

/** The one entry of {@link DELEGATE_FOLDERS} that is synthesised
 * ({@link SAS_CONTENT_ROOT}) rather than fetched with
 * `GET /folders/folders/@name`. */
export const SYNTHETIC_ROOT_DELEGATE = "@sasRoot";

/** This extension's own `type` value for the synthetic SAS Content pseudo-root
 * ({@link SAS_CONTENT_ROOT}). Not a value the service ever returns. */
export const ROOT_FOLDER_TYPE = "RootFolder";

/** The Folders service collection every delegate and root folder lives under.
 * The one path this module composes rather than following a link — see
 * `src/content/adapter.ts`'s doc comment. */
export const FOLDERS_COLLECTION = "/folders/folders";

/**
 * The synthetic "SAS Content" node — upstream's `ROOT_FOLDER`.
 *
 * It has no service representation: the tree renders it from this constant and,
 * when it is expanded, queries `${FOLDERS_COLLECTION}?filter=isNull(parent)…`
 * for the folders that have no parent (finding 84). `id` is a fixed sentinel,
 * not a service id.
 */
export const SAS_CONTENT_ROOT: ContentItem = {
  id: "sas-content-root",
  name: "SAS Content",
  type: ROOT_FOLDER_TYPE,
  uri: FOLDERS_COLLECTION,
  links: [],
};

/** Whether an item is {@link SAS_CONTENT_ROOT}. */
export function isSasContentRoot(item: ContentItem): boolean {
  return item.type === ROOT_FOLDER_TYPE && item.id === SAS_CONTENT_ROOT.id;
}

/**
 * The `type` values that name something the tree can descend into.
 *
 * `child` is deliberately absent: a member record's navigability is decided by
 * its {@link ContentItem.contentType} (`folder`), not its `type`, so
 * {@link isContainer} consults `contentType` for a member and this set for
 * everything read directly. `userFolder` / `userRoot` are upstream's names for
 * an administrator browsing another user's tree — carried for parity even
 * though this slice never surfaces them.
 */
const CONTAINER_TYPE_NAMES: ReadonlySet<string> = new Set([
  ROOT_FOLDER_TYPE,
  "folder",
  "myFolder",
  "favoritesFolder",
  "trashFolder",
  "userFolder",
  "userRoot",
]);

/** The member `contentType` value that is itself a folder. */
export const FOLDER_CONTENT_TYPE = "folder";

/**
 * The effective type name of an item — its `contentType` if it is a member
 * record (`type: "child"`), otherwise its `type`. Upstream's `getTypeName`.
 */
export function typeNameOf(item: ContentItem): string | undefined {
  return item.type === "child" ? item.contentType : item.type;
}

/** Whether the tree can expand this item. */
export function isContainer(item: ContentItem): boolean {
  const name = typeNameOf(item);
  return name !== undefined && CONTAINER_TYPE_NAMES.has(name);
}

/**
 * The member content types the tree asks the Folders service to include.
 *
 * Upstream's `FILE_TYPES` (`file`, `dataFlow`) plus the folder types, used to
 * build the `in(contentType, …)` / `in(type, …)` filter that keeps
 * non-navigable member kinds (jobs, reports, and so on) out of the listing.
 * The tree still only *descends* into folders — a `dataFlow` is shown as a
 * leaf — but it is listed so the count a user sees matches what SAS Studio
 * would show.
 */
export const LISTED_MEMBER_TYPES = [
  "file",
  "dataFlow",
  "folder",
  ROOT_FOLDER_TYPE,
  "myFolder",
  "favoritesFolder",
  "userFolder",
  "userRoot",
  "trashFolder",
] as const;

/**
 * The `in(<field>,'a','b',…)` clause for {@link LISTED_MEMBER_TYPES}.
 *
 * `field` is `type` for the `isNull(parent)` root query and `contentType` for
 * a folder's members (upstream's `generateTypeQuery`) — the two collections
 * key the same information on different fields.
 */
export function memberTypeFilter(field: "type" | "contentType"): string {
  const quoted = LISTED_MEMBER_TYPES.map((t) => `'${t}'`).join(",");
  return `in(${field},${quoted})`;
}

/**
 * The address of the underlying resource an item names.
 *
 * `item.uri` when the representation states one (a member record), else the
 * `self` link's `href` (a delegate or root-listing folder, finding 84), else
 * `undefined`. Upstream's `getResourceIdFromItem`, whose `self`-link fallback
 * finding 84 confirms is exercised on the very first level the tree renders.
 */
export function resourceHrefOf(item: ContentItem): string | undefined {
  if (item.uri !== undefined && item.uri !== "") return item.uri;
  const self = item.links.find((link) => link.rel === SELF_REL);
  return self?.href;
}

/**
 * Reads one item out of a parsed Folders/Files response.
 *
 * Takes `unknown` because it is handed the output of `JSON.parse`. An entry
 * with no string `id` or `name` cannot be rendered or expanded, so it is
 * dropped rather than carried as a half-item that fails later — the same shape
 * `readName` takes in `src/compute/files.ts`. `links` is run through
 * {@link readLinks}, which drops the Folders service's duplicate `uri` /
 * `itemType` link keys (see `src/wire/links.ts`).
 */
export function readContentItem(value: unknown): ContentItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const id = raw.id;
  const name = raw.name;
  if (typeof id !== "string" || id === "") return undefined;
  if (typeof name !== "string" || name === "") return undefined;

  return {
    id,
    name,
    ...(typeof raw.type === "string" ? { type: raw.type } : {}),
    ...(typeof raw.contentType === "string"
      ? { contentType: raw.contentType }
      : {}),
    ...(typeof raw.uri === "string" ? { uri: raw.uri } : {}),
    ...(typeof raw.memberCount === "number"
      ? { memberCount: raw.memberCount }
      : {}),
    links: readLinks(value),
  };
}
