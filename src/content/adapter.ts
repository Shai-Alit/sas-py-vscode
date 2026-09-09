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
 * ## Two paths this module composes, and why that is not an ADR-0010 breach
 *
 * ADR-0010 says navigate by relation, not by a path this project wrote. This
 * module composes exactly two, both of which the Folders service's own link
 * documents make load-bearing and upstream relies on identically:
 *
 * - **`GET /folders/folders/@myFavorites`** (and `@myFolder`, `@myRecycleBin`)
 *   — the delegate-folder mechanism. There is no link to these; the `@name`
 *   segment *is* the API (finding 97).
 * - **`${folderUri}/members`** for a folder that carries no `members` link.
 *   Delegate and root-listing folders carry one (finding 97/84) and it is
 *   followed; a folder *member* record does not (finding 99), and its
 *   children are reached by composing `members` onto its `uri`, exactly as
 *   `RestContentAdapter.generatedMembersUrlForParentItem` does.
 *
 * The query string (`limit`, `filter`) is appended to whichever href results.
 * The filter value is sent **raw** — `in(contentType,'file',…)` with its
 * quotes and parentheses intact — matching upstream and what the live probe
 * accepted (findings 98/99); `resolveHref` deliberately does not re-encode it.
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
