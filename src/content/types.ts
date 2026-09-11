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
 * and {@link isContainer} has to read all three (findings 97–99, `verde`,
 * 2026-09-09):
 *
 * - **A delegate folder** — `GET /folders/folders/@myFolder` and friends.
 *   `type` is `myFolder` / `favoritesFolder` / `trashFolder`; there is no
 *   `contentType`, and no `uri` field (its address is the `self` link).
 * - **A root folder** — an item of the `isNull(parent)` listing the SAS
 *   Content pseudo-root renders. `type` is `folder`; `contentType` and `uri`
 *   are **absent** (finding 98), so the `self` link is again the only address.
 * - **A member** — an entry of a folder's `members` collection. `type` is
 *   `"child"` for an ordinary member, `"reference"` for a My Favorites entry
 *   (finding 6.13); either way `contentType` is `folder` or `file` and is what
 *   actually says whether the tree can descend, and `uri` points at the
 *   underlying resource (`/folders/folders/{id}` or `/files/files/{id}`).
 */

import { findLink, readLinks, type Link } from "../wire/links";

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
   * `trashFolder` for a folder-shaped thing read directly; `"child"` for an
   * ordinary member record and `"reference"` for a My Favorites entry (finding
   * 6.13), both of which carry the real kind in {@link ContentItem.contentType}.
   * `RootFolder` is this extension's own synthetic value for the SAS Content
   * pseudo-root — see {@link SAS_CONTENT_ROOT}.
   */
  readonly type?: string | undefined;
  /**
   * A member record's underlying kind — `folder` or `file` (finding 99). A
   * member carries it (`type: "child"` or `"reference"`); absent on every
   * folder read directly.
   */
  readonly contentType?: string | undefined;
  /**
   * The Types-service definition name a member resolved to — `file_py` for a
   * `.py`, `file` for a plain file, absent for a folder (finding 99). Read so
   * the rename path can pass it as the `{newtype}` of a `validateRename`
   * check (finding 6.6) without a second lookup.
   */
  readonly typeDefName?: string | undefined;
  /**
   * The underlying resource's address, when the representation states one. A
   * member carries it (`/folders/folders/{id}` or `/files/files/{id}`); a
   * delegate or root-listing folder does not (finding 98), and the tree falls
   * back to the `self` link — see {@link resourceHrefOf}.
   */
  readonly uri?: string | undefined;
  /**
   * The folder this item currently lives in. A member record carries it
   * (finding 99/6.10); a folder or delegate read directly does not. Read by the
   * drag-and-drop move (6c-ii) to skip a no-op drop back onto the current
   * parent without a request.
   */
  readonly parentFolderUri?: string | undefined;
  /**
   * Set by {@link ContentAdapter.getChildItems} on the direct children of the
   * Recycle Bin delegate — **not** a wire field. 6c-ii's drag-and-drop move
   * refuses to re-parent a recycled item (that would be a restore, which is
   * 6d's); `previousParent` cannot stand in for this, since finding 6.10 showed
   * every once-moved member carries that link too.
   */
  readonly inRecycleBin?: boolean | undefined;
  /**
   * Set by {@link ContentAdapter.getChildItems} (with `markFavorites`) — **not**
   * a wire field. `true` when this item's underlying resource is referenced from
   * the My Favorites delegate, so `src/content/presentation.ts` offers "Remove
   * from My Favorites" rather than "Add". 6d-i.
   */
  readonly isInMyFavorites?: boolean | undefined;
  /**
   * The href of the favourite *reference* member record to `DELETE` to
   * unfavourite this item — set alongside {@link ContentItem.isInMyFavorites}.
   * A reference member's own `deleteResource` link points at the underlying
   * file, so removing a favourite must use this (its `delete`/`self` link),
   * never `deleteResource` (finding 6.13).
   */
  readonly favoriteUri?: string | undefined;
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
 * folders; **absent** on a folder *member* record (finding 99), where the
 * tree composes `${uri}/members` instead. */
export const MEMBERS_REL = "members";

/** `GET` the folder a member currently lives in. Carried by every member
 * record (finding 99); the drag-and-drop move reads it to skip a no-op drop
 * onto the current parent (6c-ii). */
export const UP_REL = "up";

/**
 * `GET` the flat ancestor chain of a resource — `/folders/ancestors?childUri=…`,
 * immediate parent first, up to the top-most visible folder (finding 6.12).
 * Carried by every folder read directly and every member record, and it
 * advertises `type: application/vnd.sas.content.folder.ancestor`, so the client
 * asks for the object form `{ childUri, ancestors: [<folder>…] }` — not the
 * bare array `application/json` yields, which also 404s for a top-level folder.
 * {@link ContentAdapter.getParentOfItem} follows it for `TreeView.reveal`
 * (6c-iii).
 */
export const ANCESTORS_REL = "ancestors";

/** `POST` a `{name}` body to create a sub-folder. Its href is
 * `/folders/folders?parentFolderUri={this folder}` — the same string the
 * adapter would compose, so following the relation and composing agree
 * (finding 6.3). Present on delegate and ordinary folders; absent on the
 * synthetic {@link SAS_CONTENT_ROOT}. */
export const CREATE_CHILD_REL = "createChild";

/** `POST` a `{uri,type,name,contentType}` body to link an existing resource
 * into this folder as a member (finding 6.4 — the second half of file
 * create). */
export const ADD_MEMBER_REL = "addMember";

/** `PUT` a `{name}` body to rename a folder, or the member representation to
 * rename a member (findings 6.5/6.7). */
export const UPDATE_REL = "update";

/** `DELETE` the underlying resource behind a member — `/files/files/{id}` for a
 * file, `/folders/folders/{id}` for a sub-folder (finding 6.8). */
export const DELETE_RESOURCE_REL = "deleteResource";

/** `DELETE` a member *record* (or a folder read directly). After
 * {@link DELETE_RESOURCE_REL} the Folders service usually removes the member
 * itself, so a follow-up here is often already a `404` — finding 6.8. */
export const DELETE_REL = "delete";

/** `DELETE` a folder and, the name notwithstanding, only its *empty* self:
 * finding 6.8 measured a `409 errorCode 11516` on both cadences when the
 * folder still holds a non-folder member, so the adapter empties a folder
 * itself before following this. */
export const DELETE_RECURSIVELY_REL = "deleteRecursively";

/** `GET` the folder a recycled member used to live in. Every current `verde`
 * Recycle Bin member carries it (finding 6.14); restore is
 * {@link ContentAdapter.moveItem} back to this href. Absent on an item that
 * has never been recycled. */
export const PREVIOUS_PARENT_REL = "previousParent";

/** `PUT` (templated `?value={newname}&type={newtype}`) to check a rename before
 * committing it. Answers `200` with `{valid:true}` or `{valid:false,error:{…}}`
 * — finding 6.6. */
export const VALIDATE_RENAME_REL = "validateRename";

/** `PUT` (templated `.../@new/name?value={newname}&type={newtype}`) to check a
 * new child's name before creating it (finding 6.6). */
export const VALIDATE_NEW_MEMBER_NAME_REL = "validateNewMemberName";

/** The Files service collection new file resources are `POST`ed to. Composed,
 * like {@link FOLDERS_COLLECTION}, because create has no representation to hang
 * a link off yet. */
export const FILES_COLLECTION = "/files/files";

/** The Types service query the create-file path reads to resolve an extension
 * to a `typeDefName` (`getTypeDefinition`, finding 79 / 6.9). */
export const TYPES_COLLECTION = "/types/types";

/**
 * The four delegate folders the SAS Content tree shows at its top level, in
 * display order (matching upstream's `SAS_CONTENT_ROOT_FOLDERS`).
 *
 * `@myFavorites`, `@myFolder` and `@myRecycleBin` each resolve with a
 * `GET /folders/folders/@name` (finding 97). `@sasRoot` does **not** — it is a
 * synthetic node standing for "every folder with no parent", rendered from
 * {@link SAS_CONTENT_ROOT} and expanded with an `isNull(parent)` query
 * (finding 98).
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
 * for the folders that have no parent (finding 98). `id` is a fixed sentinel,
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

/** The member `contentType` value for an ordinary file — the one kind of leaf
 * the `sasContent:` `FileSystemProvider` can open (finding 99). A `dataFlow`
 * leaf is listed but not openable this way. */
export const FILE_CONTENT_TYPE = "file";

/**
 * The effective type name of an item — its `contentType` when it is a member
 * record, otherwise its `type`. Upstream's `getTypeName`.
 *
 * A member carries its real kind in `contentType` and a placeholder in `type`:
 * `"child"` for an ordinary member, `"reference"` for a My Favorites entry
 * (finding 6.13). Both must defer to `contentType`, or a favourited folder
 * browsed under My Favorites reads as a non-navigable `"reference"` leaf and a
 * favourited file cannot be opened.
 */
export function typeNameOf(item: ContentItem): string | undefined {
  return item.type === "child" || item.type === "reference"
    ? item.contentType
    : item.type;
}

/** Whether the tree can expand this item. */
export function isContainer(item: ContentItem): boolean {
  const name = typeNameOf(item);
  return name !== undefined && CONTAINER_TYPE_NAMES.has(name);
}

/**
 * The delegate-folder `type` values — the three fetched with
 * `GET /folders/folders/@name` (finding 97). A delegate is a container but is
 * **not** something the user can rename or delete, and only `@myFolder` among
 * them is a sane create target — `src/content/presentation.ts` gives them their
 * own `contextValue` so the context menu can say so.
 */
const DELEGATE_FOLDER_TYPES: ReadonlySet<string> = new Set([
  "myFolder",
  "favoritesFolder",
  "trashFolder",
]);

/** Whether an item is one of the three fetched delegate folders (My Folder /
 * My Favorites / Recycle Bin) — not the synthetic {@link SAS_CONTENT_ROOT},
 * which {@link isSasContentRoot} covers. */
export function isDelegateFolder(item: ContentItem): boolean {
  return item.type !== undefined && DELEGATE_FOLDER_TYPES.has(item.type);
}

/** Whether an item is the "My Folder" delegate specifically — the one delegate
 * a user may create content directly inside. */
export function isMyFolderDelegate(item: ContentItem): boolean {
  return item.type === "myFolder";
}

/** Whether an item is the "My Favorites" delegate (`@myFavorites` resolves to
 * `type: "favoritesFolder"`, finding 97). Its own direct children are every one
 * a favourite; a drop onto it is an add-to-favourites, not a move. 6d-i. */
export function isFavoritesDelegate(item: ContentItem): boolean {
  return item.type === "favoritesFolder";
}

/** The member `type` a favourite is added as — a *reference*, not a `child`:
 * a resource can be referenced from many folders and keeps its own
 * authorizations, where a `child` can live in exactly one folder (finding 6.13,
 * and the Folders v7 OpenAPI). */
export const FAVORITE_MEMBER_TYPE = "reference";

/** The delegate `type` of the Recycle Bin — `@myRecycleBin` resolves to this
 * (finding 97). Its direct children are flagged {@link ContentItem.inRecycleBin}
 * by {@link ContentAdapter.getChildItems}. */
export const TRASH_FOLDER_TYPE = "trashFolder";

/** The `@name` segment that resolves the Recycle Bin delegate folder
 * (`GET /folders/folders/@myRecycleBin`, finding 97). The move destination for
 * a recycle is this folder's own `self` href — finding 6.14. */
export const RECYCLE_BIN_DELEGATE = "@myRecycleBin";

/** Whether an item is the Recycle Bin delegate. */
export function isRecycleBinDelegate(item: ContentItem): boolean {
  return item.type === TRASH_FOLDER_TYPE;
}

/**
 * Whether "Delete" on this item should move it to the Recycle Bin rather than
 * remove it outright (6d-ii, upstream's `canRecycleResource`).
 *
 * Only a `type: "child"` member has a member record with the `self`/`update`
 * link {@link ContentAdapter.moveItem} re-parents — a root-listing folder read
 * directly (`type: "folder"`) has none, so deleting one is unavoidably
 * permanent. An item already in the Recycle Bin
 * ({@link ContentItem.inRecycleBin}) is past recycling too.
 */
export function isRecyclableMember(item: ContentItem): boolean {
  return item.type === "child" && item.inRecycleBin !== true;
}

/**
 * Whether a recycled item can be restored — it carries the
 * {@link PREVIOUS_PARENT_REL} link naming where it used to live (finding 6.14).
 * Every current `verde` bin member does; upstream keeps the negative case only
 * as defence (Finding 81), and the tree offers no Restore without it.
 */
export function isRestorable(item: ContentItem): boolean {
  return findLink(item.links, PREVIOUS_PARENT_REL) !== undefined;
}

/**
 * The lower-cased extension of a file name (no leading dot), or `undefined`
 * when the name has no `.` or ends with one. `getTypeDefinition` keys the
 * Types-service lookup on it; upstream's `fileName.split(".").pop()`.
 */
export function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
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
 * `self` link's `href` (a delegate or root-listing folder, finding 98), else
 * `undefined`. Upstream's `getResourceIdFromItem`, whose `self`-link fallback
 * finding 98 confirms is exercised on the very first level the tree renders.
 */
export function resourceHrefOf(item: ContentItem): string | undefined {
  if (item.uri !== undefined && item.uri !== "") return item.uri;
  const self = item.links.find((link) => link.rel === SELF_REL);
  return self?.href;
}

/**
 * The item in `siblings` that denotes the same underlying resource as `target`,
 * matched on {@link resourceHrefOf}.
 *
 * A create or move response is the new resource's own representation (a folder
 * carries its folder id) or its member record (a file carries the member id),
 * while a folder's members listing is member records throughout — so the two
 * disagree on `id` but agree on the `/folders/folders/{id}` or
 * `/files/files/{id}` the member's `uri` and the folder's `self` link both name
 * (finding 99). 6c-iii's reveal-after-create uses this to hand
 * `TreeView.reveal` the node the tree actually rendered rather than one whose
 * id will not match. Returns `undefined` when `target` has no resolvable href
 * or nothing in `siblings` shares it.
 */
export function sameResource(
  target: ContentItem,
  siblings: readonly ContentItem[],
): ContentItem | undefined {
  const href = resourceHrefOf(target);
  if (href === undefined) return undefined;
  return siblings.find((sibling) => resourceHrefOf(sibling) === href);
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
    ...(typeof raw.typeDefName === "string"
      ? { typeDefName: raw.typeDefName }
      : {}),
    ...(typeof raw.uri === "string" ? { uri: raw.uri } : {}),
    ...(typeof raw.parentFolderUri === "string"
      ? { parentFolderUri: raw.parentFolderUri }
      : {}),
    ...(typeof raw.memberCount === "number"
      ? { memberCount: raw.memberCount }
      : {}),
    links: readLinks(value),
  };
}
