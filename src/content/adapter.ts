// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The model behind the SAS Content tree: the four top-level folders, the
 * members of any folder the user expands, the open/save of a file's bytes
 * (6b), and — 6c-i — creating, renaming and deleting folders and files from
 * the tree context menu.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: `RestContentAdapter.ts` in
 * sassoftware/vscode-sas-extension (Apache-2.0), read for what it does and
 * audited rather than transcribed. Everything gated on
 * `ConnectionType.IOM`/`COM` or `ContentSourceType.SASServer` is skipped:
 * [`docs/phases/phase-6.md`](../../docs/phases/phase-6.md)'s "no adapter
 * factory" decision and [ADR-0026](../../docs/adr/0026-content-adapter-shape.md)
 * — this project is Viya-REST/SAS-Content only, so there is one concrete
 * adapter and no `ContentAdapterFactory`/`ContentModel` layer above it. The
 * VS Code `TreeDataProvider` in `src/content/contentTree.ts` talks to this
 * class directly; the HTTP-boundary test seam is a fake {@link ContentClient}.
 *
 * ## Three paths this module composes, and why that is not an ADR-0010 breach
 *
 * ADR-0010 says navigate by relation, not by a path this project wrote. This
 * module composes exactly three, each of which a link the deployment hands back
 * makes load-bearing and upstream relies on identically:
 *
 * - **`GET /folders/folders/@myFavorites`** (and `@myFolder`, `@myRecycleBin`)
 *   — the delegate-folder mechanism. There is no link to these; the `@name`
 *   segment *is* the API (finding 97).
 * - **`${folderUri}/members`** for a folder that carries no `members` link.
 *   Delegate and root-listing folders carry one (finding 97/84) and it is
 *   followed; a folder *member* record does not (finding 99), and its
 *   children are reached by composing `members` onto its `uri`, exactly as
 *   `RestContentAdapter.generatedMembersUrlForParentItem` does.
 * - **`${fileResourceHref}/content`** for a file's bytes. The tree *member*
 *   record carries only `getResource` → the file resource (finding 99); the
 *   file resource representation itself carries `content` (GET) and
 *   `updateContent` (PUT) relations, both at exactly `${self}/content`
 *   (finding 6.1). {@link ContentAdapter.readFileContent} /
 *   {@link ContentAdapter.writeFileContent} compose that suffix rather than
 *   spend a round trip reading the representation first — the same trade
 *   `${uri}/members` above makes, and upstream's `getContentOfUri` composes
 *   the identical string.
 *
 * On the folder paths the query string (`limit`, `filter`) is appended to
 * whichever href results. The filter value is sent **raw** —
 * `in(contentType,'file',…)` with its quotes and parentheses intact — matching
 * upstream and what the live probe accepted (findings 98/99); `resolveHref`
 * deliberately does not re-encode it.
 *
 * ## No `sortBy`, so no cadence branch
 *
 * Upstream's member query carries a `sortBy` param and an inline
 * `this.viyaCadence === "2023.03"` check gating one clause of it — the exact
 * version-branch `eslint.config.mjs` forbids outside `src/dialects/`. This
 * module omits `sortBy` entirely and orders the results itself
 * ({@link byFolderThenName}): folders before files, then by name. One deliberate
 * behavioural deviation from upstream, recorded in ADR-0026 and the phase
 * file's "Dialect risk" note. If a real cadence-shaped difference turns up in a
 * later slice's probing, *that* gets a dialect method and an ADR — not an
 * inline string compare here.
 */

import { findLink, type Link } from "../wire/links";
import {
  type ContentClient,
  type ContentFailure,
  type ContentResponse,
  type ContentResult,
} from "./client";
import {
  ADD_MEMBER_REL,
  ANCESTORS_REL,
  CREATE_CHILD_REL,
  DELEGATE_FOLDERS,
  DELETE_RECURSIVELY_REL,
  DELETE_REL,
  DELETE_RESOURCE_REL,
  extensionOf,
  FAVORITE_MEMBER_TYPE,
  FILES_COLLECTION,
  FOLDERS_COLLECTION,
  isContainer,
  isFavoritesDelegate,
  isRecycleBinDelegate,
  isSasContentRoot,
  MEMBERS_REL,
  memberTypeFilter,
  readContentItem,
  resourceHrefOf,
  SAS_CONTENT_ROOT,
  SELF_REL,
  SYNTHETIC_ROOT_DELEGATE,
  typeNameOf,
  TYPES_COLLECTION,
  UPDATE_REL,
  VALIDATE_NEW_MEMBER_NAME_REL,
  VALIDATE_RENAME_REL,
  type ContentItem,
} from "./types";

/**
 * The `limit` on a member query.
 *
 * Upstream's value, unchanged — one page big enough that no folder this
 * project has seen is truncated by it (finding 99: a 38-member folder came
 * back whole with no `next` link). Pagination past this limit is unprobed and
 * left for a slice that needs it; a folder with more than a million members is
 * not a case this tree is sized for.
 */
const MEMBER_LIMIT = 1_000_000;

/** The relation a file resource representation carries for reading its bytes,
 * and — composed the same way — the suffix this module appends to a member's
 * own `uri` to reach them (finding 6.1). `GET`. */
const CONTENT_REL = "content";

/** The relation a file resource representation carries for replacing its bytes
 * (finding 6.1). `PUT`, at `${self}/content`. */
const UPDATE_CONTENT_REL = "updateContent";

/**
 * The response-body cap for a file read, well above the transport's 1 MiB
 * default. A `.py` past 10 MiB is not something this extension can usefully put
 * in an editor; the transport rejects a body over this with a
 * `ResponseTooLargeError`, which `src/content/client.ts` turns into a
 * `content-too-large` problem — a "too large to open here, use SAS Studio"
 * message rather than a silently truncated buffer or a misleading
 * "could not reach SAS Viya".
 */
export const MAX_FILE_CONTENT_BYTES = 10 * 1024 * 1024;

/**
 * The per-request timeout for the two calls that move file bytes, rather than
 * `client.ts`'s 15s default — that was sized for the small JSON listing reads
 * this client used to make exclusively, and a file near {@link MAX_FILE_CONTENT_BYTES}
 * over a slow or proxied link can take longer, which would otherwise surface as
 * a bare "could not reach SAS Viya".
 */
const CONTENT_TRANSFER_TIMEOUT_MS = 60_000;

/** The `Content-Type` sent on a write when the preceding read did not report
 * one. Finding 6.2: the Files service does not validate it, so this only has to
 * be a sane default, not the true type. */
const DEFAULT_CONTENT_TYPE = "text/plain";

/**
 * The `typeDefName` a new file falls back to when its extension resolves to no
 * registered type — upstream's `defaultContentType`. Findings 79/6.9: `.py`
 * resolves to `file_py` on both a 2026.03 and a 2026.06 deployment, so this
 * arm is a guard for an older or freshly-installed one, not a path either
 * probed deployment takes.
 */
const DEFAULT_TYPE_DEF = "file";

/** The `typeDefName` upstream hard-codes for `.sas`, skipping the Types-service
 * lookup — kept for parity even though this extension's primary extension is
 * `.py`. */
const SAS_PROGRAM_TYPE_DEF = "programFile";

/** The `Content-Type` sent with the (empty) body of a file-create `POST` when
 * the resolved type carries no media type of its own. Finding 6.2: not
 * validated, so a sane default is enough. */
const DEFAULT_NEW_FILE_CONTENT_TYPE = "application/octet-stream";

/** A file's size and timestamps, for a `vscode.FileStat`. Epoch milliseconds;
 * `undefined` where the representation gave nothing parseable. */
export interface FileStat {
  readonly size: number;
  readonly createdAt: number | undefined;
  readonly modifiedAt: number | undefined;
}

/** A file's bytes plus the entity tag a later conditional write sends back. */
export interface FileContent {
  readonly bytes: Uint8Array;
  readonly etag: string | undefined;
  readonly contentType: string | undefined;
}

/**
 * What {@link ContentAdapter.writeFileContent} needs to write safely — the
 * `etag` and `contentType` from the read that populated the editor buffer,
 * carried by the caller (the `FileSystemProvider`), **not** re-fetched at save
 * time. Re-reading the ETag immediately before the `PUT` would hand the server
 * a tag it considers current no matter who changed the file in between, so the
 * `412` the lost-update guard depends on could never fire.
 */
export interface WritePrecondition {
  /** The `ETag` from the file read the editor is showing. Sent as `If-Match`. */
  readonly etag: string;
  /** That read's `Content-Type`. Not validated server-side (finding 6.2), sent
   * for correctness; {@link DEFAULT_CONTENT_TYPE} stands in when absent. */
  readonly contentType: string | undefined;
}

export class ContentAdapter {
  constructor(private readonly client: ContentClient) {}

  /**
   * The four top-level folders, in display order.
   *
   * `@sasRoot` is {@link SAS_CONTENT_ROOT} — synthetic, no request. The other
   * three are `GET /folders/folders/@name` (finding 97). Resilient to a single
   * unreadable delegate: if at least one resolves, the resolved ones are
   * returned (a user without Recycle Bin access still sees My Folder); only
   * when *every* fetch fails is the first failure propagated, so a dead
   * connection or an expired token still surfaces as an error rather than an
   * empty tree.
   */
  async getRootItems(
    signal?: AbortSignal,
  ): Promise<ContentResult<readonly ContentItem[]>> {
    const items: ContentItem[] = [];
    let fetched = 0;
    let firstFailure: ContentFailure | undefined;

    for (const name of DELEGATE_FOLDERS) {
      if (name === SYNTHETIC_ROOT_DELEGATE) {
        items.push(SAS_CONTENT_ROOT);
        continue;
      }

      fetched += 1;
      const link: Link = {
        rel: SELF_REL,
        href: `${FOLDERS_COLLECTION}/${name}`,
      };
      const result = await this.client.send({ link, ...withSignal(signal) });
      if (!result.ok) {
        firstFailure ??= result;
        continue;
      }
      const item = readContentItem(result.value.body);
      if (item === undefined) {
        firstFailure ??= malformed(
          result.value,
          `the delegate folder "${name}"`,
          "and it was not a folder representation",
        );
        continue;
      }
      items.push(item);
    }

    // Every real delegate failed — report the first failure rather than a tree
    // containing nothing but an empty synthetic root.
    if (items.length <= 1 && firstFailure !== undefined && fetched > 0) {
      return firstFailure;
    }
    return { ok: true, value: items };
  }

  /**
   * The members of a folder the user expanded, folders first then by name.
   *
   * For {@link SAS_CONTENT_ROOT} this is `GET /folders/folders` with an
   * `and(isNull(parent), …)` filter (finding 98). For any other folder it
   * follows the `members` link, or composes `${uri}/members` when there is
   * none (a folder member record — finding 99).
   */
  async getChildItems(
    parent: ContentItem,
    signal?: AbortSignal,
    opts?: { readonly markFavorites?: boolean },
  ): Promise<ContentResult<readonly ContentItem[]>> {
    const target = this.membersLinkFor(parent);
    if (target === undefined) {
      return linkMissing(`folder "${parent.name}"`, MEMBERS_REL);
    }

    const result = await this.client.send({
      link: target,
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    const rawItems = readItems(result.value);
    if (rawItems === undefined) {
      return malformed(
        result.value,
        "a folder member listing",
        'and it carried no "items" array',
      );
    }

    const children: ContentItem[] = [];
    for (const raw of rawItems) {
      const item = readContentItem(raw);
      if (item !== undefined) children.push(item);
    }
    children.sort(byFolderThenName);

    // Flag the Recycle Bin's own children so 6c-ii's drag-and-drop move can
    // refuse to re-parent a recycled item (that is a restore — 6d's). Only the
    // direct children are flagged; descending into a recycled folder is a 6d
    // concern.
    if (isRecycleBinDelegate(parent)) {
      return {
        ok: true,
        value: children.map((child) => ({ ...child, inRecycleBin: true })),
      };
    }

    // My Favorites' own children are each a favourite. The record to remove is
    // the child's own `delete` link (the reference member) — never
    // `deleteResource`, which addresses the underlying file (finding 6.13).
    if (isFavoritesDelegate(parent)) {
      return {
        ok: true,
        value: children.map((child) => {
          const favoriteUri = favoriteMemberHrefOf(child);
          return favoriteUri === undefined
            ? { ...child, isInMyFavorites: true }
            : { ...child, isInMyFavorites: true, favoriteUri };
        }),
      };
    }

    // Everywhere else, when the caller asks: mark the children that are
    // referenced from My Favorites, so the context menu offers "Remove" rather
    // than "Add". One extra small request per user-driven folder expand — the
    // internal callers (recursive delete, reveal-after-create) pass no `opts`
    // and skip it. Strictly additive and best-effort: a favourites-service
    // failure leaves every child unmarked rather than blanking a good listing.
    if (opts?.markFavorites === true) {
      const favorites = await this.favoriteRecordHrefs(signal);
      return {
        ok: true,
        value: children.map((child) => {
          const href = resourceHrefOf(child);
          const favoriteUri =
            href === undefined ? undefined : favorites.get(href);
          return favoriteUri === undefined
            ? child
            : { ...child, isInMyFavorites: true, favoriteUri };
        }),
      };
    }

    return { ok: true, value: children };
  }

  /**
   * The link to `GET` for a folder's members, or `undefined` if the folder
   * offers no way to reach them.
   */
  private membersLinkFor(parent: ContentItem): Link | undefined {
    if (isSasContentRoot(parent)) {
      const filter = `and(isNull(parent),${memberTypeFilter("type")})`;
      return {
        rel: MEMBERS_REL,
        href: `${FOLDERS_COLLECTION}?limit=${String(MEMBER_LIMIT)}&filter=${filter}`,
      };
    }

    const query = `?limit=${String(MEMBER_LIMIT)}&filter=${memberTypeFilter("contentType")}`;

    const link = findLink(parent.links, MEMBERS_REL);
    if (link !== undefined) {
      return { ...link, href: `${link.href}${query}` };
    }

    const href = resourceHrefOf(parent);
    if (href !== undefined) {
      return { rel: MEMBERS_REL, href: `${href}/members${query}` };
    }

    return undefined;
  }

  /**
   * The folder an item currently lives in, for `TreeView.reveal` (6c-iii).
   *
   * `GET` the item's `ancestors` link, whose response is
   * `{ childUri, ancestors: [<folder>…] }` with the immediate parent first
   * (finding 6.12), and return that first ancestor. The link advertises its
   * media type, so `src/content/client.ts` sends the matching `Accept` and gets
   * the object form — the bare array `application/json` yields instead also
   * `404`s for a folder directly under the invisible root, which is a legitimate
   * "no parent", not an error.
   *
   * `{ ok: true, value: undefined }` for an item with no `ancestors` link, an
   * empty `ancestors` array (a folder directly under the SAS Content root), or a
   * `204` (an unknown `childUri`). The returned folder representation has
   * `uri`/`contentType` absent, like a root-listing folder (finding 98), so
   * {@link resourceHrefOf} falls back to its `self` link.
   */
  async getParentOfItem(
    item: ContentItem,
    signal?: AbortSignal,
  ): Promise<ContentResult<ContentItem | undefined>> {
    const link = findLink(item.links, ANCESTORS_REL);
    if (link === undefined) return { ok: true, value: undefined };

    const result = await this.client.send({
      link: { ...link, method: "GET" },
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    // A 204 carries no body — the service's answer for a `childUri` it does not
    // recognise as a child anywhere (finding 6.12). Treated as "no parent".
    if (result.value.body === undefined) return { ok: true, value: undefined };

    const ancestors = readAncestors(result.value.body);
    if (ancestors === undefined) {
      return malformed(
        result.value,
        "the item's ancestors",
        'and the body carried no "ancestors" array',
      );
    }
    // An empty chain is the folders directly under the invisible root — the
    // children of this tree's synthetic "SAS Content" node.
    const [first] = ancestors;
    if (first === undefined) return { ok: true, value: undefined };

    const parent = readContentItem(first);
    if (parent === undefined) {
      return malformed(
        result.value,
        "the item's ancestors",
        "and its first entry was not a folder representation",
      );
    }
    return { ok: true, value: parent };
  }

  /**
   * A file's size and timestamps — `GET` on the file resource itself.
   *
   * `vscode` calls `stat` before every open and before every save, so this is
   * the request that keeps the editor's "changed on disk" detection honest: the
   * `modifiedAt` it returns comes from the `Last-Modified` header when the
   * deployment sent one (finding 6.1), falling back to the representation's own
   * `modifiedTimeStamp`.
   */
  async statFile(
    resourceHref: string,
    signal?: AbortSignal,
  ): Promise<ContentResult<FileStat>> {
    const result = await this.client.send({
      link: { rel: SELF_REL, href: resourceHref },
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    const body: unknown = result.value.body;
    if (typeof body !== "object" || body === null) {
      return malformed(
        result.value,
        "a file representation",
        "and the body was not an object",
      );
    }
    const raw = body as Record<string, unknown>;
    return {
      ok: true,
      value: {
        // Finding 6.1 saw a numeric `size` on the `.py` file resource it
        // probed. The `: 0` is a deliberate defensive default for a
        // representation that arrives without one — the object-shape check
        // just above already rejects a non-object body as response-malformed —
        // not a silent mask for a parsing bug.
        size: typeof raw.size === "number" ? raw.size : 0,
        createdAt: parseTimestamp(raw.creationTimeStamp),
        modifiedAt:
          parseTimestamp(result.value.lastModified) ??
          parseTimestamp(raw.modifiedTimeStamp),
      },
    };
  }

  /**
   * A file's bytes, exactly as the deployment sent them.
   *
   * Composes `${resourceHref}/content` (finding 6.1's `content` relation) and
   * reads `rawBody`, never `.text` — a file this tree opens is usually text,
   * but the transport's UTF-8 decode is lossy for one that is not, and the
   * editor is entitled to the real bytes. The returned `etag` is the tag for
   * exactly these bytes; the caller keeps it and hands it back as the
   * {@link WritePrecondition} on save. Re-fetching it at save time instead
   * would defeat the lost-update guard — see {@link ContentAdapter.writeFileContent}.
   */
  async readFileContent(
    resourceHref: string,
    signal?: AbortSignal,
  ): Promise<ContentResult<FileContent>> {
    const result = await this.client.send({
      link: { rel: CONTENT_REL, href: `${resourceHref}/content` },
      maxBodyBytes: MAX_FILE_CONTENT_BYTES,
      timeoutMs: CONTENT_TRANSFER_TIMEOUT_MS,
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    if (result.value.rawBody === undefined) {
      return malformed(
        result.value,
        "a file's content",
        "and the transport returned no raw bytes for it",
      );
    }
    return {
      ok: true,
      value: {
        bytes: result.value.rawBody,
        etag: result.value.etag,
        contentType: result.value.contentType,
      },
    };
  }

  /**
   * Replace a file's bytes, guarded by the ETag the editor opened with.
   *
   * One request: `PUT ${resourceHref}/content` carrying `precondition.etag` as
   * `If-Match`. That tag has to be the one {@link ContentAdapter.readFileContent}
   * returned for the bytes now in the editor — **not** a freshly-fetched one.
   * `src/compute/files.ts` and `fileref.ts` re-read their ETag immediately
   * before mutating, but they act on a session's private working directory that
   * `PROC PYTHON`'s serial execution (ADR-0015) guarantees nothing else touches;
   * a SAS Content file is editable at the same time from SAS Studio, the web
   * client, or another editor, so the guard only means something if the tag
   * predates those edits.
   *
   * Finding 6.2: a bare `PUT` is `428`, a stale `If-Match` is `412` — both
   * come back unchanged as `content-rejected` for the caller to localise as
   * "reopen it". A `200` carries a fresh `ETag`; it is returned so the caller
   * can update what it holds and let a second save in the same session through
   * without a re-read. The sent `Content-Type` is not validated (finding 6.2)
   * but is echoed for correctness.
   */
  async writeFileContent(
    resourceHref: string,
    bytes: Uint8Array,
    precondition: WritePrecondition,
    signal?: AbortSignal,
  ): Promise<ContentResult<{ etag: string | undefined }>> {
    const put = await this.client.send({
      link: {
        rel: UPDATE_CONTENT_REL,
        href: `${resourceHref}/content`,
        method: "PUT",
      },
      rawBody: bytes,
      contentType: precondition.contentType ?? DEFAULT_CONTENT_TYPE,
      etag: precondition.etag,
      timeoutMs: CONTENT_TRANSFER_TIMEOUT_MS,
      ...withSignal(signal),
    });
    if (!put.ok) return put;
    return { ok: true, value: { etag: put.value.etag } };
  }

  // ─── 6c-i: structural mutations ────────────────────────────────────────────
  //
  // Each is driven by a link the parent or the item handed back — `createChild`,
  // `addMember`, `update`, `deleteResource`/`deleteRecursively`/`delete` (finding
  // 78, wire shapes findings 6.3–6.8). Nothing here composes a path the service
  // did not name; `createChild`'s own href already *is*
  // `/folders/folders?parentFolderUri=…`, so following it and composing agree
  // (finding 6.3).

  /**
   * Create a sub-folder under `parent` — `POST` the parent's `createChild` link
   * with a `{name}` body (finding 6.3, `201`).
   *
   * When the parent carries a `validateNewMemberName` link the name is checked
   * first (finding 6.6); a clash returns {@link ContentProblem} `content-name-rejected`
   * — the deployment's own "already exists" sentence and, when offered, a free
   * alternative — rather than letting the create come back as a bare `409`.
   */
  async createFolder(
    parent: ContentItem,
    name: string,
    signal?: AbortSignal,
  ): Promise<ContentResult<ContentItem>> {
    const link = findLink(parent.links, CREATE_CHILD_REL);
    if (link === undefined) {
      return linkMissing(`folder "${parent.name}"`, CREATE_CHILD_REL);
    }

    const nameProblem = await this.checkName(
      parent,
      VALIDATE_NEW_MEMBER_NAME_REL,
      name,
      "folder",
      signal,
    );
    if (nameProblem !== undefined) return nameProblem;

    const result = await this.client.send({
      link: { ...link, method: "POST" },
      jsonBody: { name },
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    const item = readContentItem(result.value.body);
    if (item === undefined) {
      return malformed(
        result.value,
        "the folder it created",
        "and the body was not a folder representation",
      );
    }
    return { ok: true, value: item };
  }

  /**
   * Create an empty file under `parent` and link it in — two calls (finding
   * 6.4): `POST /files/files?typeDefName=…` with a `Content-Disposition` name
   * and an empty body, then `POST` the parent's `addMember` link with
   * `{uri,type:"CHILD",name,contentType}`. If the second call fails the just
   * created file resource is deleted before the failure is returned, so a
   * half-made file is never left orphaned.
   *
   * The `typeDefName` comes from {@link getTypeDefinition}: `.sas` →
   * `programFile`, `.py` (and everything else) from a cached
   * `/types/types` lookup, falling back to `file`.
   */
  async createFile(
    parent: ContentItem,
    name: string,
    signal?: AbortSignal,
  ): Promise<ContentResult<ContentItem>> {
    const addMember = findLink(parent.links, ADD_MEMBER_REL);
    if (addMember === undefined) {
      return linkMissing(`folder "${parent.name}"`, ADD_MEMBER_REL);
    }

    const type = await this.getTypeDefinition(name, signal);

    const nameProblem = await this.checkName(
      parent,
      VALIDATE_NEW_MEMBER_NAME_REL,
      name,
      type.typeDefName,
      signal,
    );
    if (nameProblem !== undefined) return nameProblem;

    const created = await this.client.send({
      link: {
        rel: "create",
        href: `${FILES_COLLECTION}?typeDefName=${encodeURIComponent(type.typeDefName)}`,
        method: "POST",
        type: "application/vnd.sas.file",
      },
      rawBody: new Uint8Array(0),
      contentType: type.mediaType ?? DEFAULT_NEW_FILE_CONTENT_TYPE,
      contentDisposition: `filename*=UTF-8''${encodeURIComponent(name)}`,
      ...withSignal(signal),
    });
    if (!created.ok) return created;

    const fileHref = selfHrefOf(created.value.body);
    if (fileHref === undefined) {
      return malformed(
        created.value,
        "the file it created",
        "and the body carried no self link",
      );
    }

    const linked = await this.client.send({
      link: { ...addMember, method: "POST" },
      jsonBody: {
        uri: fileHref,
        type: "CHILD",
        name,
        contentType: type.typeDefName,
      },
      ...withSignal(signal),
    });
    if (!linked.ok) {
      // Roll the orphan back — the file resource exists but is linked nowhere.
      // **Deliberately not `signal`.** The likeliest reason a two-call sequence
      // fails partway is the caller's signal firing (a cancel, or the client
      // timeout), and forwarding an already-aborted signal here means the
      // rollback rejects before it reaches the network and the orphan is left
      // for good. It gets the client's own default timeout instead, so a
      // cancelled create still cleans up after itself. If the DELETE fails on
      // its own merits the file is an unreferenced resource in the user's Files
      // store, invisible in the tree — noise, not a hazard — and `linked` is the
      // failure worth returning.
      await this.client.send({
        link: { rel: DELETE_REL, href: fileHref, method: "DELETE" },
      });
      return linked;
    }

    const item = readContentItem(linked.value.body);
    if (item === undefined) {
      return malformed(
        linked.value,
        "the file member it created",
        "and the body was not a member representation",
      );
    }
    return { ok: true, value: item };
  }

  /**
   * Rename a folder or a file. Follows the item's `validateRename` link first
   * when it has one (finding 6.6 — a clash becomes `content-name-rejected`),
   * then `PUT`s the rename.
   *
   * Two shapes, and finding 6.7 is why:
   *
   * - A **member record** (`type: "child"` — every folder and file below the
   *   top level) is read through its `self` link and `PUT` straight back with
   *   just `name` changed. Both probed cadences accept the full representation
   *   here; a minimal body was not confirmed for a member. The `self` link
   *   also carries the `application/vnd.sas.content.folder.member` media type,
   *   so `Accept`/`Content-Type` come out right without this module naming a
   *   type.
   * - A **folder read directly** (a root-listing folder) takes a minimal
   *   `{name}` body via its `update` link — echoing its full representation
   *   back is rejected `400`/`errorCode 1177` on Stable 2026.06.
   *
   * **No `If-Match` on the write, deliberately.** The endpoint honours one
   * (finding 6.5: a stale tag → `412`), but the member path already `GET`s the
   * representation immediately before the `PUT`, so the only lost-update window
   * is the few milliseconds between them — and a `412` on a *rename* has no
   * sensible recovery to offer ("reopen it" means nothing here). Concurrent
   * renames are last-write-wins, which for a name — unlike file content
   * (`writeFileContent`, which does guard) — loses nothing but the losing
   * name.
   */
  async renameItem(
    item: ContentItem,
    newName: string,
    signal?: AbortSignal,
  ): Promise<ContentResult<ContentItem>> {
    const isMember = item.type === "child";
    const target = isMember
      ? findLink(item.links, SELF_REL)
      : (findLink(item.links, UPDATE_REL) ?? findLink(item.links, SELF_REL));
    if (target === undefined) {
      return linkMissing(`"${item.name}"`, isMember ? SELF_REL : UPDATE_REL);
    }

    const newType = item.typeDefName ?? typeNameOf(item) ?? "folder";
    const nameProblem = await this.checkName(
      item,
      VALIDATE_RENAME_REL,
      newName,
      newType,
      signal,
    );
    if (nameProblem !== undefined) return nameProblem;

    let body: unknown;
    if (isMember) {
      const read = await this.client.send({
        link: target,
        ...withSignal(signal),
      });
      if (!read.ok) return read;
      if (typeof read.value.body !== "object" || read.value.body === null) {
        return malformed(
          read.value,
          "the item to rename",
          "and the body was not an object",
        );
      }
      body = { ...(read.value.body as Record<string, unknown>), name: newName };
    } else {
      body = { name: newName };
    }

    const result = await this.client.send({
      link: { ...target, method: "PUT" },
      jsonBody: body,
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    const renamed = readContentItem(result.value.body);
    if (renamed === undefined) {
      return malformed(
        result.value,
        "the renamed item",
        "and the body was not a folder or member representation",
      );
    }
    return { ok: true, value: renamed };
  }

  /**
   * Move a member — a folder or file below the top level — into another folder.
   * 6c-ii.
   *
   * `GET` the member record, then `PUT` it back to the same `self` link with
   * `parentFolderUri` changed to `destinationHref`. Finding 6.10: a member
   * `PUT` needs `uri`, `type` and `name` in the body, and echoing the whole
   * representation back is what both probed cadences accept for a **file and a
   * folder** member alike — unlike a folder read directly (finding 6.7). This
   * is the same read-then-write `renameItem`'s member branch takes, and for the
   * same reason: a move only ever applies to a member.
   *
   * The member `id` is stable across the move, but its `self`/`update` href
   * changes (the parent segment updates), so the caller re-reads links from the
   * returned item rather than the one it dragged.
   *
   * **No `If-Match`.** The server rejects a self-move or a move into a
   * descendant with `400` (finding 6.10 — "A folder cannot be moved or copied
   * into itself"), which passes through as `content-rejected`; a lost-update
   * race on a move has no "reopen it" recovery to offer, the same reasoning
   * `renameItem` gives.
   */
  async moveItem(
    item: ContentItem,
    destinationHref: string,
    signal?: AbortSignal,
  ): Promise<ContentResult<ContentItem>> {
    const self =
      findLink(item.links, SELF_REL) ?? findLink(item.links, UPDATE_REL);
    if (self === undefined) {
      return linkMissing(`"${item.name}"`, SELF_REL);
    }
    // `self` and `update` address the same member record; when only `update`
    // was found it carries `method: "PUT"`, so the read is pinned to `GET`
    // rather than inheriting it.
    const read = await this.client.send({
      link: { ...self, method: "GET" },
      ...withSignal(signal),
    });
    if (!read.ok) return read;
    if (typeof read.value.body !== "object" || read.value.body === null) {
      return malformed(
        read.value,
        "the item to move",
        "and the body was not an object",
      );
    }

    const result = await this.client.send({
      link: { ...self, method: "PUT" },
      jsonBody: {
        ...(read.value.body as Record<string, unknown>),
        parentFolderUri: destinationHref,
      },
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    const moved = readContentItem(result.value.body);
    if (moved === undefined) {
      return malformed(
        result.value,
        "the moved item",
        "and the body was not a member representation",
      );
    }
    return { ok: true, value: moved };
  }

  // ─── 6d-i: favourites ─────────────────────────────────────────────────────

  /**
   * Add `item` to My Favorites — `POST` the My Favorites folder's `addMember`
   * link a `{uri, type:"reference", name, contentType}` body (finding 6.13,
   * `201`).
   *
   * A favourite is a **reference** member, not a `child`: the same resource can
   * be referenced from many folders and it keeps its own authorizations. The My
   * Favorites folder representation is fetched once and memoised for the life of
   * the adapter (which is rebuilt per deployment and on sign-out); only its
   * `addMember` link is read, and that href — `/folders/folders/{id}/members` —
   * is stable.
   */
  async addToFavorites(
    item: ContentItem,
    signal?: AbortSignal,
  ): Promise<ContentResult<void>> {
    const resource = resourceHrefOf(item);
    if (resource === undefined) {
      return linkMissing(`"${item.name}"`, SELF_REL);
    }

    const favorites = await this.favoritesFolder(signal);
    if (!favorites.ok) return favorites;
    const addMember = findLink(favorites.value.links, ADD_MEMBER_REL);
    if (addMember === undefined) {
      return linkMissing("the My Favorites folder", ADD_MEMBER_REL);
    }

    const result = await this.client.send({
      link: { ...addMember, method: "POST" },
      jsonBody: {
        uri: resource,
        type: FAVORITE_MEMBER_TYPE,
        name: item.name,
        // A member carries `contentType` (`file` / `folder`); a top-level
        // root-listing folder does not — omit it then and let the Files/Folders
        // service infer the kind from `uri` (unprobed for that one case).
        ...(item.contentType === undefined
          ? {}
          : { contentType: item.contentType }),
      },
      ...withSignal(signal),
    });
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  /**
   * Remove `item` from My Favorites — `DELETE` the favourite reference member
   * record at `item.favoriteUri` (stamped by {@link ContentAdapter.getChildItems}).
   *
   * The reference member's own `deleteResource` link points at the underlying
   * file, so unfavouriting must use this record href, never that one (finding
   * 6.13). An item with no `favoriteUri` was never marked as favourited, so
   * there is nothing to remove — `link-missing`.
   */
  async removeFromFavorites(
    item: ContentItem,
    signal?: AbortSignal,
  ): Promise<ContentResult<void>> {
    if (item.favoriteUri === undefined || item.favoriteUri === "") {
      return linkMissing(`"${item.name}"`, DELETE_REL);
    }
    const result = await this.client.send({
      link: { rel: DELETE_REL, href: item.favoriteUri, method: "DELETE" },
      ...withSignal(signal),
    });
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  /**
   * `Map<underlying resource href → favourite reference-member record href>` for
   * every current My Favorites reference.
   *
   * Built fresh from `GET /folders/folders/@myFavorites/members` on every
   * {@link ContentAdapter.getChildItems} that asks for it — deliberately not
   * cached, so a favourite added or removed elsewhere (SAS Studio, another
   * window) shows on the next expand. Finding 6.13: the folder's `memberCount`
   * cannot stand in for this (it read `1` against an empty collection), so the
   * members listing is the only authority. Any failure yields an empty map — the
   * marking it feeds is additive.
   */
  private async favoriteRecordHrefs(
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const query = `?limit=${String(MEMBER_LIMIT)}&filter=${memberTypeFilter("contentType")}`;
    const result = await this.client.send({
      link: {
        rel: MEMBERS_REL,
        href: `${FOLDERS_COLLECTION}/@myFavorites/members${query}`,
      },
      ...withSignal(signal),
    });
    if (!result.ok) return map;

    const rawItems = readItems(result.value);
    if (rawItems === undefined) return map;
    for (const raw of rawItems) {
      const item = readContentItem(raw);
      if (item === undefined) continue;
      const resource = resourceHrefOf(item);
      const record = favoriteMemberHrefOf(item);
      if (resource !== undefined && record !== undefined) {
        map.set(resource, record);
      }
    }
    return map;
  }

  /** The My Favorites folder representation, memoised on the first success. A
   * failure is returned but not cached, so a transient error does not pin the
   * adapter to a favourites-less state. */
  private async favoritesFolder(
    signal?: AbortSignal,
  ): Promise<ContentResult<ContentItem>> {
    if (this.favoritesFolderCache !== undefined) {
      return this.favoritesFolderCache;
    }
    const result = await this.client.send({
      link: { rel: SELF_REL, href: `${FOLDERS_COLLECTION}/@myFavorites` },
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    const item = readContentItem(result.value.body);
    if (item === undefined) {
      return malformed(
        result.value,
        "the My Favorites folder",
        "and the body was not a folder representation",
      );
    }
    this.favoritesFolderCache = { ok: true, value: item };
    return this.favoritesFolderCache;
  }
  private favoritesFolderCache: { ok: true; value: ContentItem } | undefined;

  /**
   * Delete a folder (recursively) or a file.
   *
   * A folder is **emptied first** — finding 6.8: `deleteRecursively` still
   * `409`s on both cadences while the folder holds a non-folder member, so its
   * listed children are deleted one at a time before the folder itself. A leaf
   * is `DELETE`d by its `deleteResource` link; the follow-up `delete` of the
   * member record is best-effort — the Folders service usually removes it with
   * the resource (`404`), and a `403` is the Stable-2026.06 "a modified folder
   * locks its owner out" quirk — so neither is treated as a failure of a
   * delete that already took.
   */
  async deleteItem(
    item: ContentItem,
    signal?: AbortSignal,
  ): Promise<ContentResult<void>> {
    return isContainer(item)
      ? await this.deleteFolder(item, signal)
      : await this.deleteLeaf(item, signal);
  }

  private async deleteFolder(
    item: ContentItem,
    signal?: AbortSignal,
  ): Promise<ContentResult<void>> {
    const children = await this.getChildItems(item, signal);
    if (!children.ok) return children;
    for (const child of children.value) {
      const removed = await this.deleteItem(child, signal);
      if (!removed.ok) return removed;
    }

    // Prefer the deepest primitive the representation offers. A folder read
    // directly carries `deleteRecursively`; a folder *member* carries
    // `deleteResource` (the folder) and `delete` (the member record) instead
    // (finding 99).
    const recursive = findLink(item.links, DELETE_RECURSIVELY_REL);
    const resource = findLink(item.links, DELETE_RESOURCE_REL);
    const link = recursive ?? resource ?? findLink(item.links, DELETE_REL);
    if (link === undefined) {
      return linkMissing(`folder "${item.name}"`, DELETE_RECURSIVELY_REL);
    }

    const result = await this.client.send({
      link: { ...link, method: "DELETE" },
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    // Deleted the folder resource directly (a folder member): tidy its member
    // record too, same swallow as a leaf.
    if (link === resource) {
      await this.tidyMemberRecord(item, signal);
    }
    return { ok: true, value: undefined };
  }

  private async deleteLeaf(
    item: ContentItem,
    signal?: AbortSignal,
  ): Promise<ContentResult<void>> {
    const resource = findLink(item.links, DELETE_RESOURCE_REL);
    if (resource === undefined) {
      return linkMissing(`"${item.name}"`, DELETE_RESOURCE_REL);
    }
    const result = await this.client.send({
      link: { ...resource, method: "DELETE" },
      ...withSignal(signal),
    });
    if (!result.ok) return result;

    await this.tidyMemberRecord(item, signal);
    return { ok: true, value: undefined };
  }

  /** Follow the `delete` link (the member record) after its resource is gone,
   * discarding the outcome — finding 6.8 says it is usually already a `404`,
   * and either way the delete the user asked for has happened. */
  private async tidyMemberRecord(
    item: ContentItem,
    signal?: AbortSignal,
  ): Promise<void> {
    const member = findLink(item.links, DELETE_REL);
    if (member === undefined) return;
    await this.client.send({
      link: { ...member, method: "DELETE" },
      ...withSignal(signal),
    });
  }

  /**
   * Resolve a file name to a Types-service definition, cached per extension for
   * the life of the adapter.
   *
   * `.sas` short-circuits to `programFile` (upstream). Everything else is
   * `GET /types/types?filter=contains('extensions','<ext>')` — the first item's
   * `name` and `mediaType` (finding 79). A name with no extension, or a lookup
   * that finds nothing, is {@link DEFAULT_TYPE_DEF}. The cache is only written
   * on a *successful* lookup, so a transient failure does not pin the fallback.
   */
  private async getTypeDefinition(
    name: string,
    signal?: AbortSignal,
  ): Promise<{ typeDefName: string; mediaType: string | undefined }> {
    const ext = extensionOf(name);
    if (ext === undefined) {
      return { typeDefName: DEFAULT_TYPE_DEF, mediaType: undefined };
    }
    if (ext === "sas") {
      return { typeDefName: SAS_PROGRAM_TYPE_DEF, mediaType: undefined };
    }

    const cached = this.typeDefCache.get(ext);
    if (cached !== undefined) return cached;

    const result = await this.client.send({
      link: {
        rel: SELF_REL,
        href: `${TYPES_COLLECTION}?filter=contains('extensions','${ext}')`,
      },
      ...withSignal(signal),
    });
    if (!result.ok) {
      return { typeDefName: DEFAULT_TYPE_DEF, mediaType: undefined };
    }

    const first = readItems(result.value)?.[0];
    let resolved: { typeDefName: string; mediaType: string | undefined } = {
      typeDefName: DEFAULT_TYPE_DEF,
      mediaType: undefined,
    };
    if (typeof first === "object" && first !== null) {
      const raw = first as Record<string, unknown>;
      if (typeof raw.name === "string" && raw.name !== "") {
        resolved = {
          typeDefName: raw.name,
          mediaType:
            typeof raw.mediaType === "string" ? raw.mediaType : undefined,
        };
      }
    }
    this.typeDefCache.set(ext, resolved);
    return resolved;
  }
  private readonly typeDefCache = new Map<
    string,
    { typeDefName: string; mediaType: string | undefined }
  >();

  /**
   * Run the name-validation relation `rel` (`validateNewMemberName` on a
   * create, `validateRename` on a rename) if the representation carries it, and
   * turn a `{valid:false}` verdict into a {@link ContentProblem}
   * `content-name-rejected`. `undefined` means "go ahead" — the name is fine,
   * or the check could not run and the mutation itself will report any clash.
   */
  private async checkName(
    representation: ContentItem,
    rel: string,
    name: string,
    newType: string,
    signal?: AbortSignal,
  ): Promise<ContentFailure | undefined> {
    const link = findLink(representation.links, rel);
    if (link === undefined) return undefined;

    const href = link.href
      .replace("{newname}", encodeURIComponent(name))
      .replace("{newtype}", encodeURIComponent(newType));
    const result = await this.client.send({
      link: { rel: link.rel, href, method: "PUT" },
      ...withSignal(signal),
    });
    if (!result.ok) return undefined;
    return readNameVerdict(result.value.body, name);
  }
}

/** An ISO-8601 or HTTP-date string as epoch milliseconds, or `undefined` if it
 * is neither a string nor a date `Date.parse` understands. */
function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Folders before files; within a group, by name, case-insensitively. */
function byFolderThenName(a: ContentItem, b: ContentItem): number {
  const aFolder = isContainer(a);
  const bFolder = isContainer(b);
  if (aFolder !== bFolder) return aFolder ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** The `ancestors` array of an `application/vnd.sas.content.folder.ancestor+json`
 * body (finding 6.12), or `undefined` when the parsed body is not that shape.
 * An empty `ancestors: []` is a valid answer and comes back as `[]`. */
function readAncestors(body: unknown): readonly unknown[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const ancestors: unknown = (body as { ancestors?: unknown }).ancestors;
  return Array.isArray(ancestors)
    ? (ancestors as readonly unknown[])
    : undefined;
}

/** The `items` of a collection body, or `undefined` if there is no array. */
function readItems(response: ContentResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
}

/**
 * The href of the favourite *reference* member record for an item — the target
 * of the `DELETE` that unfavourites it.
 *
 * Prefers the `delete` link (the relation whose method and meaning are "remove
 * this record"); finding 6.13 observed `self` and `delete` carrying the **same**
 * href on a reference member, so the `?? self` is an equivalent-link fallback for
 * a representation that omits `delete`, not an unprobed guess. Never
 * `deleteResource`, which on a reference member addresses the underlying file
 * (finding 6.13).
 */
function favoriteMemberHrefOf(item: ContentItem): string | undefined {
  return (
    findLink(item.links, DELETE_REL)?.href ??
    findLink(item.links, SELF_REL)?.href
  );
}

/** The `self` link href of a representation body, or `undefined`. Used on the
 * file-create response, whose `self` addresses the new `/files/files/{id}` that
 * `addMember` then links in (finding 6.4). */
function selfHrefOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const links = (body as { links?: unknown }).links;
  if (!Array.isArray(links)) return undefined;
  for (const entry of links as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (
      raw.rel === SELF_REL &&
      typeof raw.href === "string" &&
      raw.href !== ""
    ) {
      return raw.href;
    }
  }
  return undefined;
}

/**
 * Read a `validateNewMemberName` / `validateRename` response body (finding
 * 6.6). `{valid:true}` (or an unreadable body) → `undefined`, meaning proceed.
 * `{valid:false}` → a `content-name-rejected` failure carrying the deployment's
 * own `error.message` and, when its `error.details` offers one, the free
 * alternative name (`Suggestion: <name>`).
 */
function readNameVerdict(
  body: unknown,
  attempted: string,
): ContentFailure | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const raw = body as Record<string, unknown>;
  if (raw.valid !== false) return undefined;

  const err =
    typeof raw.error === "object" && raw.error !== null
      ? (raw.error as Record<string, unknown>)
      : {};
  const message =
    typeof err.message === "string" && err.message !== ""
      ? err.message
      : `the name "${attempted}" cannot be used here`;
  const suggestion = readSuggestion(err.details);
  return {
    ok: false,
    reason: `SAS Viya rejected the name "${attempted}": ${message}`,
    problem: {
      code: "content-name-rejected",
      message,
      ...(suggestion === undefined ? {} : { suggestion }),
    },
  };
}

/** The `Suggestion: <name>` line out of a validation error's `details` array. */
function readSuggestion(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined;
  for (const entry of details as readonly unknown[]) {
    if (typeof entry !== "string") continue;
    const match = /^suggestion:\s*(.+)$/i.exec(entry.trim());
    if (match?.[1] !== undefined && match[1] !== "") return match[1];
  }
  return undefined;
}

/** Passes a signal through only when there is one, so the request object never
 * carries an explicit `signal: undefined`. */
function withSignal(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/** The failure for a representation that carried no such relation. */
function linkMissing(resource: string, rel: string): ContentFailure {
  return {
    ok: false,
    reason: `the ${resource} carried no "${rel}" link in the response this account read`,
    problem: { code: "link-missing", rel, resource },
  };
}

/** The failure for a 2xx that was not the representation expected. */
function malformed(
  response: ContentResponse,
  subject: string,
  defect: string,
): ContentFailure {
  return {
    ok: false,
    reason: `the SAS Content service did not answer with ${subject}`,
    problem: {
      code: "response-malformed",
      detail: `a SAS Content request answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
    },
  };
}
