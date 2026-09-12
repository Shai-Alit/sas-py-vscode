// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A fake {@link CasClient} scripted from `test/fixtures/cas/`, so
 * `cas-adapter.test.ts` exercises the real `CasAdapter` against recorded
 * `casManagement` wire shapes without a live deployment and without copying
 * the adapter's own logic into the test.
 *
 * The seam is the same one `recorded-content.ts` uses one layer over: a
 * `send` that dispatches on the request's link `href`, with any query string
 * stripped for a bare-string route so a route need not spell out the
 * adapter's own `?value=loaded` or a paginated `?limit=…`.
 */

import {
  type CasClient,
  type CasRequest,
  type CasResponse,
  type CasResult,
} from "../../src/cas/client";
import { type CasProblem } from "../../src/cas/problems";
import { readJsonFixture } from "./fixtures";

/** One recorded request, for a test to assert what the adapter asked for. */
export interface RecordedCasCall {
  readonly href: string;
  readonly method: string;
}

/** A successful JSON reply. */
export function casOk(
  body: unknown,
  init?: { status?: number; contentType?: string },
): CasResult<CasResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      contentType: init?.contentType ?? "application/vnd.sas.collection+json",
      text: JSON.stringify(body),
      body,
    },
  };
}

/** A successful plain-text reply — what the load toggle answers with
 * (Finding 8.8: `"loaded"`/`"unloaded"`, `text/plain`, not JSON). */
export function casText(text: string): CasResult<CasResponse> {
  return {
    ok: true,
    value: {
      status: 200,
      contentType: "text/plain; charset=utf-8",
      text,
      body: undefined,
    },
  };
}

/** A failure the client would have produced for a non-2xx or transport
 * error. */
export function casFail(
  problem: CasProblem,
  reason = "recorded failure",
): CasResult<CasResponse> {
  return { ok: false, reason, problem };
}

/** A reply built from a named fixture under `test/fixtures/cas/`. */
export function casFixture(name: string): CasResult<CasResponse> {
  return casOk(readJsonFixture("cas", name));
}

type Matcher = string | RegExp | ((href: string, method: string) => boolean);
type Responder =
  CasResult<CasResponse> | ((request: CasRequest) => CasResult<CasResponse>);

export interface RecordedCasRoute {
  readonly when: Matcher;
  readonly reply: Responder;
}

function matches(matcher: Matcher, href: string, method: string): boolean {
  if (typeof matcher === "function") return matcher(href, method);
  if (matcher instanceof RegExp) return matcher.test(href);
  const [bare] = href.split("?");
  return bare === matcher || href === matcher;
}

/**
 * A {@link CasClient} that answers from `routes`, in order, and records every
 * call. An unmatched request throws — an unscripted route is a test bug, not
 * a scenario.
 */
export function recordedCasClient(routes: readonly RecordedCasRoute[]): {
  client: CasClient;
  calls: RecordedCasCall[];
} {
  const calls: RecordedCasCall[] = [];
  const client: CasClient = {
    send: (request) => {
      const href = request.link.href;
      const method = request.link.method ?? "GET";
      calls.push({ href, method });
      for (const route of routes) {
        if (matches(route.when, href, method)) {
          const { reply } = route;
          return Promise.resolve(
            typeof reply === "function" ? reply(request) : reply,
          );
        }
      }
      throw new Error(`recorded-cas: no route for ${method} ${href}`);
    },
  };
  return { client, calls };
}
