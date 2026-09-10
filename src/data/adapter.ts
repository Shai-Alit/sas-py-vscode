// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The read model behind the SAS Libraries tree: the active session's
 * libraries, and the tables in any library the user expands.
 *
 * **This module must never import `vscode`.**
 *
 * Structure follows: `RestLibraryAdapter.ts` in sassoftware/vscode-sas-extension
 * (Apache-2.0), read for what it does and audited rather than transcribed —
 * per [ADR-0027](../../docs/adr/0027-library-adapter-shape.md), which settles
 * why this is one concrete class (no `LibraryAdapterFactory`, no
 * `ItcLibraryAdapter`) and why it borrows the active profile's session from
 * `ComputeSessionManager` rather than owning a connection of its own.
 *
 * ## Two probe-grounded corrections this implementation makes to the Plan
 *
 * `docs/phases/phase-7.md`'s Plan section, written before this code, expected
 * two things a fresh probe (Finding 7.8, 2026-09-09, `verde`) found were not
 * quite right:
 *
 * - **The `tables` relation needs no `itemtype` accept-header parameter.**
 *   Finding 7.5 recorded the *documented* mechanism as
 *   `Accept: application/vnd.sas.collection+json;itemtype=…table.summary`,
 *   and `Link`/`readLinks` (`src/wire/links.ts`) do not carry `itemType` at
 *   all — a real gap, had it been load-bearing. It is not: probing the exact
 *   same URI with a **bare** `Accept: application/vnd.sas.collection+json`
 *   (no `itemtype`) returned the identical tables collection, envelope
 *   `"accept":"application/vnd.sas.compute.data.table.summary"` — the
 *   deployment infers the item type from the base media type alone, because
 *   `library`/`library.summary`/`collection` are the only three
 *   representations this URI ever serves. So `client.send({ link })` with the
 *   library's own `tables` link (`type: "application/vnd.sas.collection"`,
 *   `acceptFor` deriving `application/vnd.sas.collection+json`) is sufficient
 *   — no wire-layer change, and no `itemtype` string appears anywhere in this
 *   module. This is what ADR-0027 predicted ("no new media-type constant");
 *   the probe is what confirms it rather than leaves it assumed.
 * - **A collection's own `next` link must not be sent as-is.** The same probe
 *   found the `next` link the tables collection returns carries **no `type`
 *   at all** — and following it bare (`Accept` omitted, the ordinary
 *   `acceptFor` behaviour for a typeless link) does not continue the tables
 *   listing: it returns the **library's own rich detail**, on the identical
 *   URI, because an absent `Accept` falls back to that URI's default
 *   representation. A naive `findLink(body.links, "next")` used directly as
 *   the next page's request would therefore silently switch representations
 *   mid-listing on page 2. {@link collectPages} avoids this by keeping the
 *   *first* link's own `type`/`responseType` fixed across every page and
 *   varying only the `href` a `next` link names — the request that actually
 *   reaches the wire always carries the accept header that got page 1 right.
 *   Recorded as Finding 7.9 (`docs/phases/phase-7.md`).
 *
 * ## Busy-session guard
 *
 * Finding 7.3 (reconfirmed twice — Findings 7.5–7.7): a `DataAccessApi` read
 * blocks at the SAS kernel behind a running job rather than erroring. Every
 * public method here checks `LibrarySessionSource.isBusy` first and refuses
 * with `session-busy` instead of issuing a request that would hang silently
 * for the run's duration — ADR-0027's "refuse rather than queue".
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResponse,
} from "../compute/client";
import { asSessionGone, type ComputeSession } from "../compute/session";
import { findLink, readLinks, type Link } from "../wire/links";
import { type DataProblem } from "./problems";
import {
  LIBREFS_REL,
  readLibraryItem,
  readTableItem,
  SELF_REL,
  TABLES_REL,
  type LibraryItem,
  type TableItem,
} from "./types";

/** A failed data-browsing call, named on its own so a helper that only
 * handles failures need not be generic — the same split `ComputeFailure` and
 * `ContentFailure` make. */
export interface DataFailure {
  ok: false;
  reason: string;
  problem: DataProblem;
}

export type DataResult<T> = { ok: true; value: T } | DataFailure;

/** The one thing `LibraryAdapter` reads out of a `ComputeConnection`. Narrowed
 * so a test need not build a whole one — `ComputeConnection` itself satisfies
 * this structurally. */
export interface ConnectedSession {
  readonly client: ComputeClient;
  readonly session: ComputeSession;
}

/**
 * What `LibraryAdapter` needs from `ComputeSessionManager`, narrowed to two
 * methods so a test need not stand up the whole manager.
 *
 * ADR-0027: the adapter asks for the active profile's session each time it
 * needs one rather than holding a connection of its own, so a tree populated
 * on VS Code's own schedule never triggers an interactive sign-in or an
 * implicit session start — an absent session is `not-connected`, not a
 * silent empty list.
 */
export interface LibrarySessionSource {
  current(profileId: string): ConnectedSession | undefined;
  isBusy(profileId: string): boolean;
}

export class LibraryAdapter {
  constructor(
    private readonly sessions: LibrarySessionSource,
    private readonly profileId: string,
  ) {}

  /**
   * The active session's libraries, each with its rich detail already
   * resolved (`readOnly`, `concatenationCount`, and — load-bearing — the
   * `tables` link {@link getTables} follows).
   *
   * Two requests per library: the session's `librefs` collection (paginated
   * — a deployment can hold more libraries than one page, verde showed a
   * `count` of 14 against a 10-item default page), then one follow-up per
   * entry on its own `self` link for the rich representation (Findings
   * 7.2/7.5) — the same two-tier fetch upstream's `getLibraries` makes,
   * `client.send({ link: self })` rather than a composed URL (ADR-0027).
   *
   * An entry with no `self` link, or whose follow-up does not answer with a
   * library representation, is dropped rather than failing the whole
   * listing — the same per-item tolerance `src/content/adapter.ts` applies
   * to a member it cannot parse. A transport-level failure (a dead session,
   * an unreachable deployment) still propagates, since that is not a defect
   * in one item.
   */
  async getLibraries(
    signal?: AbortSignal,
  ): Promise<DataResult<readonly LibraryItem[]>> {
    const required = this.require();
    if (!required.ok) return required;
    const { client, session } = required.value;

    const link = findLink(session.links, LIBREFS_REL);
    if (link === undefined) {
      return linkMissing(`compute session "${session.id}"`, LIBREFS_REL);
    }

    const sparse = await this.collectPages(client, link, signal);
    if (!sparse.ok) return sparse;

    const libraries: LibraryItem[] = [];
    for (const raw of sparse.value) {
      const stub = readLibraryItem(raw);
      if (stub === undefined) continue;

      const self = findLink(stub.links, SELF_REL);
      if (self === undefined) continue;

      const richResult = await client.send({
        link: self,
        ...withSignal(signal),
      });
      if (!richResult.ok) return wrapCompute(asSessionGone(richResult));

      const rich = readLibraryItem(richResult.value.body);
      if (rich === undefined) continue;
      libraries.push(rich);
    }
    return { ok: true, value: libraries };
  }

  /**
   * The tables in `library`, sparse (Finding 7.8: a 394-table `SASHELP`
   * listing carried only `{ id, name, version, links }` per entry) — no
   * per-table follow-up, `readOnly` inherited from `library` instead (see
   * `src/data/types.ts`'s own doc comment for why).
   */
  async getTables(
    library: LibraryItem,
    signal?: AbortSignal,
  ): Promise<DataResult<readonly TableItem[]>> {
    const required = this.require();
    if (!required.ok) return required;
    const { client } = required.value;

    const link = findLink(library.links, TABLES_REL);
    if (link === undefined) {
      return linkMissing(`library "${library.name}"`, TABLES_REL);
    }

    const sparse = await this.collectPages(client, link, signal);
    if (!sparse.ok) return sparse;

    const tables: TableItem[] = [];
    for (const raw of sparse.value) {
      const table = readTableItem(raw, library);
      if (table !== undefined) tables.push(table);
    }
    return { ok: true, value: tables };
  }

  /**
   * The busy check and session lookup every public method starts with.
   * `isBusy` is checked before `current` so a session that is present but
   * busy is reported as `session-busy` rather than momentarily masquerading
   * as connected.
   */
  private require(): DataResult<ConnectedSession> {
    if (this.sessions.isBusy(this.profileId)) {
      return {
        ok: false,
        reason:
          "the compute session is running Python and cannot be browsed right now",
        problem: { code: "session-busy" },
      };
    }
    const connection = this.sessions.current(this.profileId);
    if (connection === undefined) {
      return {
        ok: false,
        reason: "no active SAS Viya session for browsing libraries",
        problem: { code: "not-connected" },
      };
    }
    return { ok: true, value: connection };
  }

  /**
   * Reads every page of a collection, following `next` to the end.
   *
   * **Every page is requested with `link`'s own `type`/`responseType` — never
   * the `next` link's.** See this module's own doc comment (Finding 7.9): a
   * `next` link here carries no media type of its own, and following it
   * literally sends no `Accept` at all, which this URI answers with the
   * *library's* rich detail rather than a continued tables listing. Fixing
   * the accept header to page 1's and varying only the `href` is what keeps
   * every page reading as the same representation.
   *
   * **Bounded at {@link MAX_DATA_PAGES}, the same runaway guard
   * `compute/fileref.ts`'s `listFilerefNames` carries (`MAX_FILEREF_PAGES`)
   * for the identical reason: a `next` link this project did not construct
   * should never be trusted to terminate on its own.** That is not
   * theoretical here — a broken test double (fixed 2026-09-09, see
   * `test/helpers/recorded-data.ts`'s own doc comment) answered the same page
   * forever, and this loop obligingly followed its identical `next` link
   * forever with it, until the process ran out of heap. A malformed or
   * cyclical `next` from a real deployment is unlikely but not impossible,
   * and the guard costs nothing on the happy path: `WORK`/`SASHELP` and every
   * deployment probed this phase have needed at most a handful of pages.
   * Hitting the bound returns what was gathered so far rather than failing —
   * the same choice `listFilerefNames` makes.
   */
  private async collectPages(
    client: ComputeClient,
    link: Link,
    signal: AbortSignal | undefined,
  ): Promise<DataResult<readonly unknown[]>> {
    const items: unknown[] = [];
    let href: string | undefined = link.href;

    for (let page = 0; href !== undefined && page < MAX_DATA_PAGES; page += 1) {
      const pageLink: Link = { ...link, href };
      const result = await client.send({
        link: pageLink,
        ...withSignal(signal),
      });
      if (!result.ok) return wrapCompute(asSessionGone(result));

      const pageItems = readItems(result.value);
      if (pageItems === undefined) {
        return malformed(
          result.value,
          `a "${link.rel}" collection`,
          'and it carried no "items" array',
        );
      }
      items.push(...pageItems);

      const next = findLink(readLinks(result.value.body), "next");
      href = next?.href;
    }
    return { ok: true, value: items };
  }
}

/**
 * Enough pages of a `DataAccessApi` collection (a session's libraries, or a
 * library's tables) to hold everything a real deployment has shown this
 * phase — see {@link LibraryAdapter.collectPages}'s own doc comment for why
 * this exists as a runaway guard rather than an expected limit. The largest
 * collection probed this phase, `SASHELP`'s 394 tables, is 79 pages at the one
 * page size Finding 7.9 actually observed the server paginate it at
 * (`limit=5`) — the only number here with a live probe behind it; nothing
 * about the adapter or the wire sets `limit`, so a real deployment's own page
 * size is whatever the server chooses. 500 pages is headroom well past that,
 * not a real ceiling anyone browsing libraries is expected to reach.
 */
export const MAX_DATA_PAGES = 500;

/** The `items` of a collection body, or `undefined` if there is no array there. */
function readItems(response: ComputeResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
}

/** Passes a signal through only when there is one, so the request object
 * never carries an explicit `signal: undefined`. */
function withSignal(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/** Rewrites a `ComputeFailure` as a `DataFailure`, delegating the vocabulary
 * rather than re-diagnosing it — see this module's own doc comment. */
function wrapCompute(failure: ComputeFailure): DataFailure {
  return {
    ok: false,
    reason: failure.reason,
    problem: { code: "compute", problem: failure.problem },
  };
}

/** The failure for a representation that carried no such relation. */
function linkMissing(resource: string, rel: string): DataFailure {
  return {
    ok: false,
    reason: `the ${resource} carried no "${rel}" link in the response this account read`,
    problem: {
      code: "compute",
      problem: { code: "link-missing", rel, resource },
    },
  };
}

/** The failure for a 2xx that was not the representation expected. */
function malformed(
  response: ComputeResponse,
  subject: string,
  defect: string,
): DataFailure {
  return {
    ok: false,
    reason:
      "the compute service did not answer with what this request expected",
    problem: {
      code: "compute",
      problem: {
        code: "response-malformed",
        detail: `a request for ${subject} answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
      },
    },
  };
}
