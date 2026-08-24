// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import { type Link } from "../../src/compute/links";
import { type ComputeSession } from "../../src/compute/session";
import { readVariable, VARIABLES_REL } from "../../src/compute/variables";

/**
 * Reading one session variable — the read `SYSCC` needs (ADR-0014), and
 * nothing else. Finding 60 is the wire evidence: a name filter on the
 * `variables` collection returns the value inline, so this module makes one
 * request and never follows a variable's own `self` link.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const VARIABLES_PATH = `${SESSION_PATH}/variables`;

function sessionLinks(): readonly Link[] {
  return [
    {
      method: "GET",
      rel: VARIABLES_REL,
      href: VARIABLES_PATH,
      responseType: "application/vnd.sas.collection",
    },
  ];
}

function session(links?: readonly Link[]): ComputeSession {
  return { id: SESSION_ID, state: "idle", links: links ?? sessionLinks() };
}

function ok(body: unknown, status = 200): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status,
      notModified: false,
      contentType: "application/vnd.sas.collection+json",
      text: JSON.stringify(body),
      body,
    },
  };
}

interface Fake {
  readonly requests: ComputeRequest[];
  readonly client: ComputeClient;
}

function fake(reply: ComputeResult<ComputeResponse>): Fake {
  const requests: ComputeRequest[] = [];
  const client: ComputeClient = {
    send: (request) => {
      requests.push(request);
      return Promise.resolve(reply);
    },
  };
  return { requests, client };
}

describe("readVariable", () => {
  it("reads the value from a filtered collection item", async () => {
    const scripted = fake(
      ok({ count: 1, items: [{ name: "SYSCC", value: "0" }] }),
    );

    const result = await readVariable(scripted.client, session(), "SYSCC");

    assert.ok(result.ok);
    assert.equal(result.value, "0");
    assert.equal(scripted.requests.length, 1);
    assert.equal(scripted.requests[0]?.link.rel, VARIABLES_REL);
  });

  it("follows the session's variables link with an encoded name filter", async () => {
    const scripted = fake(
      ok({ count: 1, items: [{ name: "SYSCC", value: "0" }] }),
    );

    await readVariable(scripted.client, session(), "SYSCC");

    const href = scripted.requests[0]?.link.href;
    assert.ok(href, "no request was sent");
    assert.ok(href.startsWith(VARIABLES_PATH));
    // Doubled first, then percent-encoded — the same order `contextFilter`
    // requires, so decoding this back out has to reproduce `eq(name,'SYSCC')`.
    assert.equal(
      decodeURIComponent(
        new URL(`https://x${href}`).search.slice(1).split("=")[1] ?? "",
      ),
      "eq(name,'SYSCC')",
    );
  });

  it("keeps any query the variables link already carried", async () => {
    const scripted = fake(
      ok({ count: 1, items: [{ name: "SYSCC", value: "0" }] }),
    );
    const linked = session([
      {
        method: "GET",
        rel: VARIABLES_REL,
        href: `${VARIABLES_PATH}?limit=200`,
        responseType: "application/vnd.sas.collection",
      },
    ]);

    await readVariable(scripted.client, linked, "SYSCC");

    const href = scripted.requests[0]?.link.href;
    assert.ok(href, "no request was sent");
    assert.ok(href.includes("limit=200"));
    assert.ok(href.includes("&filter="));
  });

  it("returns undefined when the filter matches nothing", async () => {
    const scripted = fake(ok({ count: 0, items: [] }));

    const result = await readVariable(scripted.client, session(), "NOSUCHVAR");

    assert.ok(result.ok);
    assert.equal(result.value, undefined);
  });

  it("ignores an item whose name does not match what was asked for", async () => {
    // Nothing has measured the filter ever doing this; the check is defensive
    // rather than a response to an observed defect, and is cheap against a
    // page the filter has already narrowed to one item.
    const scripted = fake(
      ok({ count: 1, items: [{ name: "OTHER", value: "x" }] }),
    );

    const result = await readVariable(scripted.client, session(), "SYSCC");

    assert.ok(result.ok);
    assert.equal(result.value, undefined);
  });

  it("fails when the session carries no variables link", async () => {
    const scripted = fake(ok({}));

    const result = await readVariable(scripted.client, session([]), "SYSCC");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });

  it("fails when the response carries no items array", async () => {
    const scripted = fake(ok({ count: 0 }));

    const result = await readVariable(scripted.client, session(), "SYSCC");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("fails when the response body is not an object at all", async () => {
    // `readItems`'s guard is `typeof body !== "object" || body === null` —
    // two distinct conditions collapsed into one early return. A body that
    // is not an object (a bare string, here) trips the first; nothing had
    // exercised it, only the "object but no items key" shape above.
    const scripted = fake(ok("not a collection at all"));

    const result = await readVariable(scripted.client, session(), "SYSCC");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("fails when the response body is null", async () => {
    // The second half of the same guard: `typeof null === "object"` is true
    // in JS, so `body === null` is the operand that actually catches this —
    // distinct from the "not an object" case above, and also untested.
    const scripted = fake(ok(null));

    const result = await readVariable(scripted.client, session(), "SYSCC");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("ignores an item in the collection that is not an object", async () => {
    // `readName`'s own type guard, reachable because an `items` array is
    // exactly what the wire sent — nothing upstream of it has validated each
    // element's shape yet.
    const scripted = fake(ok({ count: 1, items: ["not-an-object"] }));

    const result = await readVariable(scripted.client, session(), "SYSCC");

    assert.ok(result.ok);
    assert.equal(result.value, undefined);
  });

  it("fails when the matching item carries no string value", async () => {
    const scripted = fake(ok({ count: 1, items: [{ name: "SYSCC" }] }));

    const result = await readVariable(scripted.client, session(), "SYSCC");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("reads a session gone as session-gone, the same as every other module", async () => {
    const scripted = fake({
      ok: false,
      reason: "the compute service answered HTTP 404",
      problem: { code: "compute-rejected", error: { status: 404 } },
    });

    const result = await readVariable(scripted.client, session(), "SYSCC");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });
});
