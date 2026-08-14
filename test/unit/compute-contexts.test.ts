// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type {
  HttpTransport,
  TransportResponse,
} from "../../src/auth/transport";
import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
  createComputeClient,
} from "../../src/compute/client";
import {
  contextFilter,
  CONTEXTS_PATH,
  listContexts,
  MAX_PAGES,
  quoteFilterValue,
  resolveContext,
} from "../../src/compute/contexts";
import type { Link } from "../../src/compute/links";

/**
 * Resolving the compute context a profile names.
 *
 * Three of the cases below are the whole reason this module exists rather than
 * being three lines inside `session.ts`.
 *
 * **The apostrophe.** The filter is a string literal in a query the *user*
 * supplies half of. Upstream interpolates the name with no escaping, so a
 * context called `Ford's context` produces a `400` naming neither the context
 * nor the reason. The escape is doubling the quote (finding 15) — SQL's rule,
 * not C's — and a backslash is itself a `400`.
 *
 * **`count`.** The collection reports a real `count` only when the page already
 * holds everything and `null` whenever it does not (finding 16), so a pager that
 * trusts it reports no compute contexts on exactly the deployments that have the
 * most. Nothing here may read it, and two tests below hand it values that would
 * break a reader that did.
 *
 * **One call, not two.** The summary item already carries a fully-formed
 * `createSession` link, so the follow-up `GET /compute/contexts/{id}` upstream
 * makes is unnecessary — and a test that counts requests is the only thing that
 * keeps it that way.
 */

const ROOT = "https://viya.example.com";
const TOKEN = "test-token";
const NAME = "SAS Job Execution compute context";
const CONTEXT_ID = "00000000-0000-4000-8000-0000000000c1";

/** A `createSession` link as the deployment sends it (finding 15). */
function createSessionLink(id: string): Link {
  return {
    method: "POST",
    rel: "createSession",
    href: `${CONTEXTS_PATH}/${id}/sessions`,
    type: "application/vnd.sas.compute.session.request",
    responseType: "application/vnd.sas.compute.session",
  };
}

function contextItem(init: {
  id?: string;
  name: string;
  links?: readonly Link[];
}): unknown {
  const id = init.id ?? CONTEXT_ID;
  return {
    id,
    name: init.name,
    version: 4,
    links: init.links ?? [createSessionLink(id)],
  };
}

/**
 * A collection envelope, with the key order and the fields the service sends.
 *
 * `count` defaults to `null` because that is what a truncated collection
 * reports, and because a reader that consults it should fail every test in this
 * file rather than one of them.
 */
function collection(init: {
  items: readonly unknown[];
  links?: readonly Link[];
  count?: number | null;
}): unknown {
  return {
    accept: "application/vnd.sas.compute.context",
    count: init.count ?? null,
    items: init.items,
    limit: 10,
    links: init.links ?? [],
    name: "contexts",
    start: 0,
    version: 2,
  };
}

function ok(
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

interface Fake {
  readonly requests: ComputeRequest[];
  readonly client: ComputeClient;
}

/**
 * A client that answers from a script.
 *
 * The real client has its own suite; what is under test here is which requests
 * this module makes and what it makes of the answers, so the transport is one
 * layer too far down to be interesting — except in the two cases marked "on the
 * wire", which use the real client precisely because the encoding is the point.
 */
function fake(
  replies:
    | readonly ComputeResult<ComputeResponse>[]
    | ((index: number) => ComputeResult<ComputeResponse>),
): Fake {
  const requests: ComputeRequest[] = [];
  const client: ComputeClient = {
    send: (request) => {
      const index = requests.length;
      requests.push(request);
      const reply =
        typeof replies === "function" ? replies(index) : replies[index];
      assert.ok(
        reply !== undefined,
        `the module sent ${String(index + 1)} requests and the script had fewer replies`,
      );
      return Promise.resolve(reply);
    },
  };
  return { requests, client };
}

/** The single request the module made, so no test optional-chains an index. */
function only(requests: readonly ComputeRequest[]): ComputeRequest {
  assert.equal(
    requests.length,
    1,
    "the module did not make exactly one request",
  );
  const [request] = requests;
  assert.ok(request !== undefined);
  return request;
}

/** The real client over a recording transport, for the two "on the wire" tests. */
function onTheWire(body: unknown): { urls: string[]; client: ComputeClient } {
  const urls: string[] = [];
  const response: TransportResponse = {
    ok: true,
    status: 200,
    headers: { "content-type": "application/vnd.sas.collection+json" },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
  const transport: HttpTransport = (url) => {
    urls.push(url);
    return Promise.resolve(response);
  };
  return {
    urls,
    client: createComputeClient({ root: ROOT, token: () => TOKEN, transport }),
  };
}

describe("quoteFilterValue", () => {
  it("doubles every apostrophe", () => {
    assert.equal(quoteFilterValue("O'Brien"), "'O''Brien'");
    assert.equal(quoteFilterValue("'"), "''''");
    assert.equal(quoteFilterValue("a'b'c"), "'a''b''c'");
  });

  it("leaves a name with no apostrophe exactly as it was", () => {
    assert.equal(quoteFilterValue(NAME), `'${NAME}'`);
    assert.equal(quoteFilterValue(""), "''");
  });

  it("does not treat a backslash as an escape", () => {
    // Against the live deployment, `eq(name,'O\'Brien')` is a 400 with
    // errorCode 1104 — the same as the unescaped form. A backslash is an
    // ordinary character here and must survive as one, doubling still applied.
    assert.equal(quoteFilterValue("O\\'Brien"), "'O\\''Brien'");
  });
});

describe("contextFilter", () => {
  it("writes the equality the service parses", () => {
    assert.equal(contextFilter(NAME), `eq(name,'${NAME}')`);
    assert.equal(contextFilter("Ford's context"), "eq(name,'Ford''s context')");
  });
});

describe("resolveContext", () => {
  it("resolves in one request, keeping the createSession link", async () => {
    // The point of the whole module: upstream follows this with
    // `GET /compute/contexts/{id}`, and the summary item already has the link.
    const scripted = fake([
      ok(collection({ items: [contextItem({ name: NAME })], count: 1 })),
    ]);

    const result = await resolveContext(scripted.client, NAME);

    assert.ok(result.ok, "a matching context was reported as a failure");
    assert.deepEqual(result.value, {
      id: CONTEXT_ID,
      name: NAME,
      links: [createSessionLink(CONTEXT_ID)],
    });
    assert.equal(only(scripted.requests).link.method, "GET");
  });

  it("asks for the collection representation", async () => {
    const scripted = fake([
      ok(collection({ items: [contextItem({ name: NAME })] })),
    ]);

    await resolveContext(scripted.client, NAME);

    // Via the link's `responseType`, which the client turns into the `Accept`.
    // Left to default, a deployment could answer with something else entirely.
    assert.equal(
      only(scripted.requests).link.responseType,
      "application/vnd.sas.collection",
    );
  });

  it("on the wire: percent-encodes the filter and doubles the apostrophe", async () => {
    const wire = onTheWire(
      collection({ items: [contextItem({ name: "Ford's context" })] }),
    );

    await resolveContext(wire.client, "Ford's context");

    // The apostrophe survives the encoder — `encodeURIComponent` leaves it, and
    // RFC 3986 permits it in a query — so what reaches the parser is the doubled
    // literal. The doubling must happen first: encode first and there is no
    // quote left to double.
    assert.deepEqual(wire.urls, [
      `${ROOT}/compute/contexts?filter=eq(name%2C'Ford''s%20context')`,
    ]);
  });

  it("on the wire: encodes a name that would otherwise break the query", async () => {
    const wire = onTheWire(
      collection({ items: [contextItem({ name: "a&b c" })] }),
    );

    await resolveContext(wire.client, "a&b c");

    // An unencoded `&` would end the `filter` parameter and start another one.
    assert.deepEqual(wire.urls, [
      `${ROOT}/compute/contexts?filter=eq(name%2C'a%26b%20c')`,
    ]);
  });

  it("reports an empty collection as no such context", async () => {
    // Which is also what a context this user may not see looks like — the same
    // response by design, so the problem carries the name and the message says
    // both.
    const scripted = fake([ok(collection({ items: [], count: 0 }))]);

    const result = await resolveContext(scripted.client, "Not here");

    assert.ok(!result.ok, "an empty collection was reported as a success");
    assert.deepEqual(result.problem, {
      code: "no-such-context",
      name: "Not here",
    });
  });

  it("takes the first match deterministically", async () => {
    // Viya does not enforce unique context names. Failing on a duplicate would
    // break a deployment that works perfectly well in SAS Studio.
    const scripted = fake([
      ok(
        collection({
          items: [
            contextItem({ id: "first", name: NAME }),
            contextItem({ id: "second", name: NAME }),
          ],
        }),
      ),
    ]);

    const result = await resolveContext(scripted.client, NAME);

    assert.ok(result.ok, "a duplicated name was reported as a failure");
    assert.equal(result.value.id, "first");
  });

  it("says which context lacks a createSession link", async () => {
    // Checked at resolve time, while we still know the name. Left to session
    // creation it becomes a missing-link failure three steps away from anything
    // the user can act on.
    const scripted = fake([
      ok(
        collection({
          items: [
            contextItem({
              name: NAME,
              links: [{ rel: "self", href: `${CONTEXTS_PATH}/${CONTEXT_ID}` }],
            }),
          ],
        }),
      ),
    ]);

    const result = await resolveContext(scripted.client, NAME);

    assert.ok(!result.ok, "a context with no createSession link resolved");
    assert.deepEqual(result.problem, {
      code: "link-missing",
      rel: "createSession",
      resource: `compute context "${NAME}"`,
    });
  });

  it("does not relabel a 404 as a missing context", async () => {
    // A 404 on the collection means the Compute service is not at that path —
    // a deployment problem. Calling it "no such context" sends someone to check
    // the spelling of a setting that is spelled correctly.
    const rejected: ComputeResult<ComputeResponse> = {
      ok: false,
      reason: "the compute service answered HTTP 404",
      problem: { code: "compute-rejected", error: { status: 404 } },
    };
    const scripted = fake([rejected]);

    const result = await resolveContext(scripted.client, NAME);

    assert.deepEqual(result, rejected);
  });

  it("reports a body that is not a collection without quoting it", async () => {
    const scripted = fake([
      ok("<html>gateway</html>", { contentType: "text/html" }),
    ]);

    const result = await resolveContext(scripted.client, NAME);

    assert.ok(!result.ok, "a gateway page was read as a collection");
    assert.equal(result.problem.code, "response-malformed");
    assert.ok(
      !JSON.stringify(result).includes("gateway"),
      "the response body was repeated into the problem",
    );
  });

  it("reports a matching item that has no id and name", async () => {
    // Fatal here, and merely skipped in listContexts: the filter said this item
    // matched, so a shape we cannot read is a shape change, not one bad row.
    const scripted = fake([ok(collection({ items: [{ links: [] }] }))]);

    const result = await resolveContext(scripted.client, NAME);

    assert.ok(!result.ok, "an item with no id was resolved");
    assert.equal(result.problem.code, "response-malformed");
  });

  it("passes the caller's signal through", async () => {
    const controller = new AbortController();
    const scripted = fake([
      ok(collection({ items: [contextItem({ name: NAME })] })),
    ]);

    await resolveContext(scripted.client, NAME, { signal: controller.signal });

    assert.equal(only(scripted.requests).signal, controller.signal);
  });
});

describe("listContexts", () => {
  const NEXT: Link = {
    rel: "next",
    href: "/compute/contexts?start=10&limit=10",
    method: "GET",
    type: "application/vnd.sas.collection",
  };

  it("follows the next link and stops when there is none", async () => {
    const scripted = fake([
      ok(
        collection({
          items: [contextItem({ id: "a", name: "A" })],
          links: [{ rel: "self", href: CONTEXTS_PATH }, NEXT],
        }),
      ),
      ok(
        collection({
          items: [contextItem({ id: "b", name: "B" })],
          count: 2,
          links: [{ rel: "self", href: NEXT.href }],
        }),
      ),
    ]);

    const result = await listContexts(scripted.client);

    assert.ok(result.ok, "a two-page traversal was reported as a failure");
    assert.deepEqual(
      result.value.map((context) => context.name),
      ["A", "B"],
    );
    // The second request follows the server's href exactly as sent, rather than
    // composing a `start`/`limit` of our own.
    assert.deepEqual(
      scripted.requests.map((request) => request.link.href),
      [CONTEXTS_PATH, NEXT.href],
    );
  });

  it("returns the contexts of a page whose count is null", async () => {
    // The single test that would fail against a count-trusting pager: `null`
    // read as a number is 0, so it would answer "no compute contexts" here.
    const scripted = fake([
      ok(
        collection({
          items: [contextItem({ name: NAME })],
          count: null,
        }),
      ),
    ]);

    const result = await listContexts(scripted.client);

    assert.ok(result.ok, "a null count was reported as a failure");
    assert.equal(result.value.length, 1);
  });

  it("keeps paging while count says the collection is complete", async () => {
    // The mirror image: `count` is a real number on the *last* page, and a pager
    // that stopped once it had `count` items would drop everything after it.
    const scripted = fake([
      ok(
        collection({
          items: [contextItem({ id: "a", name: "A" })],
          count: 1,
          links: [NEXT],
        }),
      ),
      ok(collection({ items: [contextItem({ id: "b", name: "B" })] })),
    ]);

    const result = await listContexts(scripted.client);

    assert.ok(result.ok, "a traversal past a stated count failed");
    assert.equal(result.value.length, 2);
  });

  it("drops an unreadable item rather than the page", async () => {
    const scripted = fake([
      ok(
        collection({
          items: [
            contextItem({ id: "a", name: "A" }),
            { id: 7, name: "B" },
            { id: "c" },
            null,
            "context",
            contextItem({ id: "d", name: "D" }),
          ],
        }),
      ),
    ]);

    const result = await listContexts(scripted.client);

    assert.ok(result.ok, "one bad row emptied the collection");
    assert.deepEqual(
      result.value.map((context) => context.id),
      ["a", "d"],
    );
  });

  it("gives up on a collection that never stops paging", async () => {
    // The href is the server's, so termination is the server's decision. A
    // `next` that points back at the page that produced it would otherwise spin
    // forever, re-sending the user's token once per round trip.
    const scripted = fake(() =>
      ok(collection({ items: [contextItem({ name: NAME })], links: [NEXT] })),
    );

    const result = await listContexts(scripted.client);

    assert.ok(!result.ok, "an endless traversal completed");
    assert.equal(result.problem.code, "response-malformed");
    assert.equal(scripted.requests.length, MAX_PAGES);
  });

  it("stops at the first page that fails", async () => {
    const unreachable: ComputeResult<ComputeResponse> = {
      ok: false,
      reason: "could not reach the compute service",
      problem: { code: "compute-unreachable", detail: "GET /compute/contexts" },
    };
    const scripted = fake([
      ok(collection({ items: [contextItem({ name: NAME })], links: [NEXT] })),
      unreachable,
    ]);

    const result = await listContexts(scripted.client);

    assert.deepEqual(result, unreachable);
    assert.equal(scripted.requests.length, 2);
  });

  it("asks for the whole collection with no filter", async () => {
    const scripted = fake([ok(collection({ items: [] }))]);

    const result = await listContexts(scripted.client);

    assert.ok(result.ok, "an empty deployment was reported as a failure");
    assert.deepEqual(result.value, []);
    assert.equal(only(scripted.requests).link.href, CONTEXTS_PATH);
  });
});
