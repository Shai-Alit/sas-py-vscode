// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type {
  ComputeClient,
  ComputeRequest,
  ComputeResponse,
  ComputeResult,
} from "../../src/compute/client";
import type { ViyaError } from "../../src/compute/problems";
import {
  CADENCE_REL,
  CADENCE_TYPE,
  DEPLOYMENT_DATA_PATH,
  PROBE_TIMEOUT_MS,
  probeCadence,
} from "../../src/dialects/probe";

/**
 * Stage-1 capability probing.
 *
 * Almost every case here is about one question: **what is allowed to be read as
 * "this deployment is Viya 3.5"?** Getting that wrong is not a probe bug that
 * shows up as a probe failure — the wrong dialect is chosen silently, and then
 * presents later as a handful of unrelated ones, starting with telling the user
 * their deployment has no built-in OAuth client.
 *
 * Finding 42 is why the answer is narrow. Two 404s were provoked on a live Viya
 * 4 and they are not alike: a routed service answers with a `vnd.sas.error+json`
 * document, and an unrouted path is answered by the ingress with no body at all.
 * Anything in the network path can produce the second. So `absent` is reachable
 * from exactly two shapes — a Viya-documented 404 at the entry point, and a link
 * document that genuinely does not carry the relation — and the tests below try
 * every neighbouring shape to confirm it is not reachable from those.
 */

const CADENCE_HREF = "/deploymentData/cadenceVersion";
const APP_REGISTRY_TYPE = "application/vnd.sas.app.registry.cadence.version";

/** `/deploymentData` as finding 44 recorded it, with `method: null` intact. */
function entryPointBody(links?: readonly unknown[]): unknown {
  return {
    links: links ?? [
      {
        method: null,
        rel: CADENCE_REL,
        href: CADENCE_HREF,
        uri: CADENCE_HREF,
        type: CADENCE_TYPE,
      },
      {
        method: null,
        rel: CADENCE_REL,
        href: CADENCE_HREF,
        uri: CADENCE_HREF,
        type: APP_REGISTRY_TYPE,
      },
      {
        method: null,
        rel: "setinit",
        href: "/deploymentData/setinit",
        type: "text/plain",
      },
    ],
    version: 1,
  };
}

/** The cadence resource as finding 40 recorded it. */
function cadenceBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    cadenceDisplayName: "Long-Term Support 2026.03",
    cadenceName: "lts",
    cadenceRelease: "20260721.1784653667906",
    cadenceVersion: "2026.03",
    links: [{ rel: "self", href: CADENCE_HREF, type: CADENCE_TYPE }],
    version: 1,
    ...overrides,
  };
}

function ok(
  body: unknown,
  init: { status?: number; contentType?: string } = {},
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init.status ?? 200,
      notModified: false,
      contentType: init.contentType ?? "application/json; charset=utf-8",
      text: JSON.stringify(body),
      body,
    },
  };
}

/** A 200 whose body the client did not parse — a portal's HTML, say. */
function okUnparsed(text: string): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      contentType: "text/html",
      text,
      body: undefined,
    },
  };
}

/**
 * A non-2xx, shaped exactly as `client.ts` shapes one.
 *
 * `error` is what `readViyaError` would have produced, which is the whole
 * discriminator under test: a routed Viya 404 yields a `message`, and the
 * ingress's bodyless one yields `{ status }` and nothing else.
 */
function rejected(error: ViyaError): ComputeResult<ComputeResponse> {
  return {
    ok: false,
    reason: `the compute service answered HTTP ${String(error.status)}`,
    problem: { code: "compute-rejected", error },
  };
}

function unreachable(detail: string): ComputeResult<ComputeResponse> {
  return {
    ok: false,
    reason: "could not reach the compute service",
    problem: { code: "compute-unreachable", detail },
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
 * the probe makes and what it makes of the answers.
 */
function fake(...replies: readonly ComputeResult<ComputeResponse>[]): Fake {
  const requests: ComputeRequest[] = [];
  const client: ComputeClient = {
    send: (request) => {
      const index = requests.length;
      requests.push(request);
      const reply = replies[index];
      assert.ok(
        reply !== undefined,
        `the probe sent ${String(index + 1)} requests and the script had fewer replies`,
      );
      return Promise.resolve(reply);
    },
  };
  return { requests, client };
}

/** The nth request, so no test optional-chains an index. */
function request(fixture: Fake, index: number): ComputeRequest {
  const sent = fixture.requests[index];
  assert.ok(
    sent !== undefined,
    `the probe made ${String(fixture.requests.length)} request(s), not ${String(index + 1)}`,
  );
  return sent;
}

describe("probeCadence", () => {
  describe("reading a cadence version", () => {
    it("navigates from the entry point and reads both fields", async () => {
      const fixture = fake(ok(entryPointBody()), ok(cadenceBody()));

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "cadence",
        version: "2026.03",
        display: "Long-Term Support 2026.03",
      });
      assert.equal(fixture.requests.length, 2);
    });

    it("composes the entry point and follows the href it was given", async () => {
      // ADR-0010: one composed path, everything after it from the service. The
      // second href is the deployment's, not one this project built by joining
      // the first to a segment.
      const fixture = fake(ok(entryPointBody()), ok(cadenceBody()));
      await probeCadence(fixture.client);

      assert.equal(request(fixture, 0).link.href, DEPLOYMENT_DATA_PATH);
      assert.equal(request(fixture, 1).link.href, CADENCE_HREF);
    });

    it("asks the cadence resource for plain JSON", async () => {
      // Finding 43: `application/json` is on the resource's own list of
      // acceptable types and comes back with a stable content type, where the
      // vendor type is representation-versioned and this reads two fields.
      const fixture = fake(ok(entryPointBody()), ok(cadenceBody()));
      await probeCadence(fixture.client);

      assert.equal(
        request(fixture, 0).link.responseType,
        "application/vnd.sas.api+json",
      );
      assert.equal(request(fixture, 1).link.responseType, "application/json");
    });

    it("sends GET, because the link document states no method", async () => {
      // Finding 44: `method` is `null` on every link there, so `readLinks` drops
      // it and the verb has to come from the contract file.
      const fixture = fake(ok(entryPointBody()), ok(cadenceBody()));
      await probeCadence(fixture.client);

      assert.equal(request(fixture, 1).link.method, "GET");
    });

    it("follows the deployment-data relation, not the app-registry one", async () => {
      // Both are `cadenceVersion` (finding 44). Given different hrefs here so
      // that taking whichever came first is a visible failure rather than a
      // coincidence that happens to pass.
      const fixture = fake(
        ok(
          entryPointBody([
            {
              rel: CADENCE_REL,
              href: "/deploymentData/appRegistryCadence",
              type: APP_REGISTRY_TYPE,
            },
            { rel: CADENCE_REL, href: CADENCE_HREF, type: CADENCE_TYPE },
          ]),
        ),
        ok(cadenceBody()),
      );
      await probeCadence(fixture.client);

      assert.equal(request(fixture, 1).link.href, CADENCE_HREF);
    });

    it("omits the display name when the deployment sends none", async () => {
      const fixture = fake(
        ok(entryPointBody()),
        ok(cadenceBody({ cadenceDisplayName: "   " })),
      );

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "cadence",
        version: "2026.03",
      });
    });

    it("trims what the deployment sent", async () => {
      const fixture = fake(
        ok(entryPointBody()),
        ok(cadenceBody({ cadenceVersion: " 2026.03 " })),
      );

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "cadence",
        version: "2026.03",
        display: "Long-Term Support 2026.03",
      });
    });
  });

  describe("deciding a deployment is Viya 3.5", () => {
    it("reads a missing relation as absent", async () => {
      // ADR-0010's version signal, stated exactly: a Viya service answered, with
      // a document of the right shape, and it does not offer this relation.
      const fixture = fake(
        ok(
          entryPointBody([
            { rel: "setinit", href: "/deploymentData/setinit", type: "t/p" },
          ]),
        ),
      );

      assert.deepEqual(await probeCadence(fixture.client), { kind: "absent" });
      assert.equal(fixture.requests.length, 1);
    });

    it("reads an empty link document as absent", async () => {
      const fixture = fake(ok(entryPointBody([])));
      assert.deepEqual(await probeCadence(fixture.client), { kind: "absent" });
    });

    it("reads a Viya-documented 404 at the entry point as absent", async () => {
      // Finding 42, first row: the deployment-data service is routed and
      // answering, and says it has no handler for that path. Behind a connected
      // session, that is a statement about the endpoint.
      const fixture = fake(
        rejected({
          status: 404,
          message:
            'There is no handler defined for the path "/deploymentData".',
        }),
      );

      assert.deepEqual(await probeCadence(fixture.client), { kind: "absent" });
    });

    it("does not read a bodyless 404 as absent", async () => {
      // Finding 42, second row: no body, no media type, `server: envoy`. A
      // proxy, a VPN portal or a mistyped host produces the same thing, and any
      // of them would otherwise name the generation on the deployment's behalf.
      const fixture = fake(rejected({ status: 404 }));

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail: "the compute service answered HTTP 404",
      });
    });

    it("does not read a 401 as absent", async () => {
      // Finding 41 measured the endpoint answering unauthenticated, so a 401
      // here means something other than Viya answered — but even if a future
      // deployment gates it, "sign in again" is not "this is Viya 3.5".
      const fixture = fake({
        ok: false,
        reason: "the access token is no longer active",
        problem: {
          code: "unauthorized",
          problem: { code: "session-expired" },
        },
      });

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail: "the access token is no longer active",
      });
    });

    it("does not read a 406 as absent", async () => {
      // Finding 43: a deployment that answers 406 is a Viya that *has* this
      // resource. Reading it as absent would be exactly backwards.
      const fixture = fake(
        rejected({ status: 406, message: "Not Acceptable", errorCode: 0 }),
      );

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail: "the compute service answered HTTP 406",
      });
    });

    it("does not read an unreachable deployment as absent", async () => {
      const fixture = fake(unreachable("GET /deploymentData — ETIMEDOUT"));

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail: "could not reach the compute service",
      });
    });

    it("does not read a 200 that is not a link document as absent", async () => {
      // A portal's sign-in page, served with a 200 and a content type the client
      // did not parse. `readLinks` answers `[]` for it, so without this guard the
      // absence of a relation would be indistinguishable from a service saying
      // it has none.
      const fixture = fake(okUnparsed("<html>sign in</html>"));

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail:
          "/deploymentData answered HTTP 200, but not with a link document",
      });
    });

    it("does not read a JSON document with no links as absent", async () => {
      const fixture = fake(ok({ version: 1 }));

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail:
          "/deploymentData answered HTTP 200, but not with a link document",
      });
    });

    it("does not read a Viya 404 on the cadence resource itself as absent", async () => {
      // The entry point has just advertised the relation. A resource that is
      // advertised and then refuses to answer is a deployment in a state we do
      // not understand, not an old one.
      const fixture = fake(
        ok(entryPointBody()),
        rejected({ status: 404, message: "Not Found", errorCode: 5837 }),
      );

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail: "the compute service answered HTTP 404",
      });
    });
  });

  describe("reading the cadence resource", () => {
    it("reports a body that is not an object", async () => {
      const fixture = fake(ok(entryPointBody()), ok("2026.03"));

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail: "the cadence resource answered HTTP 200 with no readable body",
      });
    });

    it("reports a missing cadenceVersion", async () => {
      const fixture = fake(
        ok(entryPointBody()),
        ok(cadenceBody({ cadenceVersion: undefined })),
      );

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail:
          "the cadence resource answered without a usable cadenceVersion field",
      });
    });

    it("reports a cadenceVersion that is not a string", async () => {
      const fixture = fake(
        ok(entryPointBody()),
        ok(cadenceBody({ cadenceVersion: 2026.03 })),
      );

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail:
          "the cadence resource answered without a usable cadenceVersion field",
      });
    });

    it("reports an empty cadenceVersion rather than an unknown release", async () => {
      // An empty string would resolve to the Viya 4 dialect with no release —
      // a real state, but not one a *successful* read should ever produce.
      const fixture = fake(
        ok(entryPointBody()),
        ok(cadenceBody({ cadenceVersion: "" })),
      );

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "unreadable",
        detail:
          "the cadence resource answered without a usable cadenceVersion field",
      });
    });

    it("ignores a display name that is not a string", async () => {
      const fixture = fake(
        ok(entryPointBody()),
        ok(cadenceBody({ cadenceDisplayName: 3 })),
      );

      assert.deepEqual(await probeCadence(fixture.client), {
        kind: "cadence",
        version: "2026.03",
      });
    });
  });

  describe("failing softly", () => {
    it("never rejects, even when the client throws", async () => {
      // §2.3's one sanctioned swallowed exception. Probing decorates a
      // connection that has already succeeded; a rejected promise here would
      // fail the connection instead.
      const client: ComputeClient = {
        send: () => {
          throw new Error("transport exploded");
        },
      };

      assert.deepEqual(await probeCadence(client), {
        kind: "unreadable",
        detail: "the cadence probe failed unexpectedly: transport exploded",
      });
    });

    it("carries no detail from a thrown value that is not an Error", async () => {
      // The message only, never the thrown value: a transport's rejection can
      // carry the request that produced it, and that request holds a token.
      const client: ComputeClient = {
        send: () =>
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the shape being guarded against: a rejection that is not an Error and is carrying request headers
          Promise.reject({ headers: { authorization: "Bearer x" } }),
      };

      assert.deepEqual(await probeCadence(client), {
        kind: "unreadable",
        detail: "the cadence probe failed unexpectedly: unknown error",
      });
    });
  });

  describe("cancellation and timeouts", () => {
    it("passes the caller's signal to every request", async () => {
      const controller = new AbortController();
      const fixture = fake(ok(entryPointBody()), ok(cadenceBody()));
      await probeCadence(fixture.client, { signal: controller.signal });

      assert.equal(request(fixture, 0).signal, controller.signal);
      assert.equal(request(fixture, 1).signal, controller.signal);
    });

    it("uses a tighter timeout than the client's default", async () => {
      // Finding 40 measured 0.25–0.29 s. Thirty seconds is the budget for a
      // request a user is waiting on; this is not one.
      const fixture = fake(ok(entryPointBody()), ok(cadenceBody()));
      await probeCadence(fixture.client);

      assert.equal(request(fixture, 0).timeoutMs, PROBE_TIMEOUT_MS);
      assert.equal(request(fixture, 1).timeoutMs, PROBE_TIMEOUT_MS);
    });

    it("honours an overriding timeout", async () => {
      const fixture = fake(ok(entryPointBody()), ok(cadenceBody()));
      await probeCadence(fixture.client, { timeoutMs: 250 });

      assert.equal(request(fixture, 0).timeoutMs, 250);
    });
  });
});
