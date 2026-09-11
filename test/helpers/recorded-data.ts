// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A fake {@link ComputeClient} scripted from `test/fixtures/data/`, so
 * `data-adapter.test.ts` exercises the real `LibraryAdapter` against recorded
 * `DataAccessApi` wire shapes (Findings 7.1–7.9, `docs/phases/phase-7.md`)
 * without a live deployment and without copying the adapter's own logic into
 * the test.
 *
 * The seam is the same one `recorded-content.ts` uses one service over: a
 * `send` that dispatches on the request's link `href`. **Unlike
 * `recorded-content.ts`, a bare string route here matches the href
 * *exactly*, query string included** — deliberately not stripped. A
 * `LibraryAdapter` page request and its own `next`-page request share one
 * base href differing only by `?start=`, so a query-stripping match (as
 * `recorded-content.ts` uses, safely, because no content test ever follows a
 * `next` link) would let a route meant for page 1 silently also answer page
 * 2 — and if page 1's own body is what comes back a second time, its `next`
 * link is identical to the one that just got followed, so the adapter's
 * pagination loop never terminates. That is not a hypothetical: an earlier
 * version of this file stripped the query the way `recorded-content.ts` does
 * and it produced exactly that infinite loop, crashing a real `npm run
 * coverage` run with a V8 out-of-memory error. Use a function matcher
 * (`(href) => href.includes("start=10")`) for anything that needs to ignore
 * part of the query.
 *
 * **What this fake does *not* simulate.** `LibraryAdapter` never inspects the
 * `Accept` header itself — that is `acceptFor`'s job inside the real
 * `createComputeClient`, already covered by `compute-client.test.ts` — so this
 * fake answers the same fixture for a given href regardless of which `Accept`
 * a real client would have derived from the link. What it *does* let a test
 * observe is which **link** (`href`, and therefore which `type`/`responseType`
 * it carried) the adapter chose to send on each call, via
 * {@link RecordedDataCall} — that is what Finding 7.9's pagination fix
 * (reusing page 1's link type across every page) actually needs pinned.
 */

import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import { type ComputeProblem } from "../../src/compute/problems";
import { readJsonFixture } from "./fixtures";

/** One recorded request, for a test to assert what the adapter asked for. */
export interface RecordedDataCall {
  readonly href: string;
  readonly method: string;
  /** The `type` the request's own link carried — `undefined` for a link with
   * none (the `next` link Finding 7.9 found untyped). Lets a pagination test
   * assert the adapter kept page 1's type rather than adopting page 2's. */
  readonly linkType: string | null | undefined;
  /** Whether this request carried an `AbortSignal` — lets a test confirm a
   * caller-supplied signal actually reaches the wire request rather than
   * being dropped on the way in. */
  readonly hadSignal: boolean;
}

/** A successful JSON reply. */
export function dataOk(
  body: unknown,
  init?: { status?: number; contentType?: string },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      notModified: false,
      contentType:
        init?.contentType ?? "application/vnd.sas.collection+json;version=2",
      text: JSON.stringify(body),
      body,
    },
  };
}

/** A successful raw-text reply — CSV, not JSON (Findings 7.15/7.20:
 * `rowsAsCSV`'s own `text/csv` content type). Unlike {@link dataOk}, `body`
 * stays `undefined`: the real `ComputeClient` only parses a JSON content type
 * (`isJson`, `src/compute/client.ts`), and a `text/csv` response leaves
 * `body` unset there too — `text` is what `LibraryAdapter.getRowsAsCsv`
 * actually reads. */
export function dataCsv(
  text: string,
  init?: { status?: number },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      notModified: false,
      contentType: "text/csv",
      text,
      body: undefined,
    },
  };
}

/** A failure the client would have produced for a non-2xx or transport error. */
export function dataFail(
  problem: ComputeProblem,
  reason = "recorded failure",
): ComputeResult<ComputeResponse> {
  return { ok: false, reason, problem };
}

/** A reply built from a named fixture under `test/fixtures/data/`. */
export function dataFixture(name: string): ComputeResult<ComputeResponse> {
  return dataOk(readJsonFixture("data", name));
}

type Matcher = string | RegExp | ((href: string, method: string) => boolean);
type Responder =
  | ComputeResult<ComputeResponse>
  | ((request: ComputeRequest) => ComputeResult<ComputeResponse>);

export interface RecordedDataRoute {
  readonly when: Matcher;
  readonly reply: Responder;
}

function matches(matcher: Matcher, href: string, method: string): boolean {
  if (typeof matcher === "function") return matcher(href, method);
  if (matcher instanceof RegExp) return matcher.test(href);
  // Exact match only — see this module's own doc comment for why stripping
  // the query here, the way `recorded-content.ts` does, is not safe once a
  // route's own href can recur with a different query string attached.
  return href === matcher;
}

/**
 * A {@link ComputeClient} that answers from `routes`, in order, and records
 * every call. An unmatched request throws — an unscripted route is a test
 * bug, not a scenario.
 */
export function recordedDataClient(routes: readonly RecordedDataRoute[]): {
  client: ComputeClient;
  calls: RecordedDataCall[];
} {
  const calls: RecordedDataCall[] = [];
  const client: ComputeClient = {
    send: (request) => {
      const href = request.link.href;
      const method = request.link.method ?? "GET";
      calls.push({
        href,
        method,
        linkType: request.link.type,
        hadSignal: request.signal !== undefined,
      });
      for (const route of routes) {
        if (matches(route.when, href, method)) {
          const { reply } = route;
          return Promise.resolve(
            typeof reply === "function" ? reply(request) : reply,
          );
        }
      }
      throw new Error(`recorded-data: no route for ${method} ${href}`);
    },
  };
  return { client, calls };
}
