// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A fake {@link ContentClient} scripted from `test/fixtures/content/`, so
 * `content-adapter.test.ts` exercises the real `ContentAdapter` against
 * recorded Folders/Files wire shapes without a live deployment and without
 * copying the adapter's own logic into the test.
 *
 * The seam is the same one `recorded-proc-python.ts` uses one layer down: a
 * `send` that dispatches on the request's link `href`. The adapter appends a
 * `?limit=…&filter=…` query to a folder's `members` href, so a route matches
 * on the href *before* the `?` unless it opts into the full string.
 */

import {
  type ContentClient,
  type ContentRequest,
  type ContentResponse,
  type ContentResult,
} from "../../src/content/client";
import { type ContentProblem } from "../../src/content/problems";
import { readJsonFixture } from "./fixtures";

/** One recorded request, for a test to assert what the adapter asked for. */
export interface RecordedContentCall {
  readonly href: string;
  readonly method: string;
}

/** A successful JSON reply. */
export function contentOk(
  body: unknown,
  init?: {
    status?: number;
    contentType?: string;
    etag?: string;
    lastModified?: string;
  },
): ContentResult<ContentResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      contentType:
        init?.contentType ?? "application/vnd.sas.collection+json;version=2",
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      ...(init?.lastModified === undefined
        ? {}
        : { lastModified: init.lastModified }),
      text: JSON.stringify(body),
      body,
    },
  };
}

/**
 * A successful raw-bytes reply — what `GET .../content` and a successful
 * `PUT .../content` return (findings 6.1/6.2). `text` mirrors the bytes so a
 * route can be asserted either way; `body` is left undefined, as the real
 * client leaves it for a non-JSON content-type.
 */
export function contentBytes(
  text: string,
  init?: {
    status?: number;
    /** A falsy value (`""`) models the `Content-Type` header being absent,
     * which is what the real client leaves as `undefined`. */
    contentType?: string;
    etag?: string;
    lastModified?: string;
  },
): ContentResult<ContentResponse> {
  const contentType =
    init && "contentType" in init
      ? init.contentType
      : "application/x-python;charset=UTF-8";
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      ...(contentType ? { contentType } : {}),
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      ...(init?.lastModified === undefined
        ? {}
        : { lastModified: init.lastModified }),
      text,
      body: undefined,
      rawBody: new TextEncoder().encode(text),
    },
  };
}

/** A failure the client would have produced for a non-2xx or transport error. */
export function contentFail(
  problem: ContentProblem,
  reason = "recorded failure",
): ContentResult<ContentResponse> {
  return { ok: false, reason, problem };
}

/** A reply built from a named fixture under `test/fixtures/content/`. */
export function contentFixture(name: string): ContentResult<ContentResponse> {
  return contentOk(readJsonFixture("content", name));
}

type Matcher = string | RegExp | ((href: string, method: string) => boolean);
type Responder =
  | ContentResult<ContentResponse>
  | ((request: ContentRequest) => ContentResult<ContentResponse>);

export interface RecordedContentRoute {
  readonly when: Matcher;
  readonly reply: Responder;
}

function matches(matcher: Matcher, href: string, method: string): boolean {
  if (typeof matcher === "function") return matcher(href, method);
  if (matcher instanceof RegExp) return matcher.test(href);
  // A bare string matches the href with any query string stripped, so a route
  // for a members collection need not spell out the adapter's `?limit=…`.
  const [bare] = href.split("?");
  return bare === matcher || href === matcher;
}

/**
 * A {@link ContentClient} that answers from `routes`, in order, and records
 * every call. An unmatched request throws — an unscripted route is a test bug,
 * not a scenario.
 */
export function recordedContentClient(
  routes: readonly RecordedContentRoute[],
): {
  client: ContentClient;
  calls: RecordedContentCall[];
} {
  const calls: RecordedContentCall[] = [];
  const client: ContentClient = {
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
      throw new Error(`recorded-content: no route for ${method} ${href}`);
    },
  };
  return { client, calls };
}
