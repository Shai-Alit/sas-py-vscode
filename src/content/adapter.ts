// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The read model behind the SAS Content tree: the four top-level folders, and
 * the members of any folder the user expands.
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
  DELEGATE_FOLDERS,
  FOLDERS_COLLECTION,
  isContainer,
  isSasContentRoot,
  MEMBERS_REL,
  memberTypeFilter,
  readContentItem,
  resourceHrefOf,
  SAS_CONTENT_ROOT,
  SELF_REL,
  SYNTHETIC_ROOT_DELEGATE,
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
 * in an editor, and the transport rejecting it there surfaces as a clear
 * "could not read" rather than a silently truncated buffer.
 */
export const MAX_FILE_CONTENT_BYTES = 10 * 1024 * 1024;

/** The `Content-Type` sent on a write when the preceding read did not report
 * one. Finding 6.2: the Files service does not validate it, so this only has to
 * be a sane default, not the true type. */
const DEFAULT_CONTENT_TYPE = "text/plain";

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
   * editor is entitled to the real bytes. The returned `etag` is what
   * {@link ContentAdapter.writeFileContent} would send as `If-Match`, though it
   * re-reads its own rather than trust one carried this far.
   */
  async readFileContent(
    resourceHref: string,
    signal?: AbortSignal,
  ): Promise<ContentResult<FileContent>> {
    const result = await this.client.send({
      link: { rel: CONTENT_REL, href: `${resourceHref}/content` },
      maxBodyBytes: MAX_FILE_CONTENT_BYTES,
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
   * Replace a file's bytes, guarded by a fresh `If-Match`.
   *
   * Two requests: a `HEAD` of `${resourceHref}/content` for the current ETag
   * and content-type, then a `PUT` of the same href carrying them. Re-reading
   * rather than accepting an ETag the editor held since it opened the file is
   * the choice `src/compute/files.ts` and `fileref.ts` both make and document —
   * nothing has measured that an older ETag is still current. `HEAD`, not
   * `GET`: finding 6.1 confirmed it returns the same `ETag`/`Last-Modified`/
   * `Content-Type` with no body, so this costs nothing and cannot trip the
   * transport's response-size cap on a large file the way pulling its whole
   * content back would. Finding 6.2: the `PUT` needs `If-Match` (a bare one is
   * `428`), the sent `Content-Type` is not validated but is echoed for
   * correctness, and a stale ETag comes back as `412` — returned here unchanged
   * as `content-rejected` for the caller to read as a conflict.
   */
  async writeFileContent(
    resourceHref: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ContentResult<void>> {
    const current = await this.client.send({
      link: {
        rel: CONTENT_REL,
        href: `${resourceHref}/content`,
        method: "HEAD",
      },
      ...withSignal(signal),
    });
    if (!current.ok) return current;
    if (current.value.etag === undefined) {
      return malformed(
        current.value,
        "a file's content",
        "and the response carried no ETag to write it back with",
      );
    }

    const put = await this.client.send({
      link: {
        rel: UPDATE_CONTENT_REL,
        href: `${resourceHref}/content`,
        method: "PUT",
      },
      rawBody: bytes,
      contentType: current.value.contentType ?? DEFAULT_CONTENT_TYPE,
      etag: current.value.etag,
      ...withSignal(signal),
    });
    if (!put.ok) return put;
    return { ok: true, value: undefined };
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

/** The `items` of a collection body, or `undefined` if there is no array. */
function readItems(response: ContentResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
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
