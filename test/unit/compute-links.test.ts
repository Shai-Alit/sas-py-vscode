// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  ForeignLinkError,
  type Link,
  computeMediaType,
  findLink,
  findLinkOfType,
  linkMethod,
  readLinks,
  resolveHref,
} from "../../src/compute/links";

/**
 * The link layer is where a wrong answer is quietest. A bad media type comes
 * back as a 415 that reads like a server problem; a mis-joined href comes back
 * as a 404 that reads like a missing session; and a followed foreign href comes
 * back as a 200, having posted the user's bearer token somewhere else.
 *
 * So the cases below are not invented. Each one is a shape observed on a live
 * Viya 4 deployment on 2026-08-14 and recorded in `PROBE-FINDINGS.md`, or a
 * shape the service must never be allowed to talk us into.
 */

describe("readLinks", () => {
  it("reads the links of a session representation", () => {
    // Finding 13, trimmed: root-relative hrefs that already carry `/compute`.
    const session = {
      id: "SESSION-ID",
      state: "pending",
      links: [
        {
          method: "GET",
          rel: "self",
          href: "/compute/sessions/SESSION-ID",
          type: "application/vnd.sas.compute.session",
        },
        {
          method: "POST",
          rel: "execute",
          href: "/compute/sessions/SESSION-ID/jobs",
          type: "application/vnd.sas.compute.job.request",
          responseType: "application/vnd.sas.compute.job",
        },
        {
          method: "GET",
          rel: "state",
          href: "/compute/sessions/SESSION-ID/state",
          type: "text/plain",
        },
      ],
    };

    const links = readLinks(session);
    assert.equal(links.length, 3);
    assert.deepEqual(links[1], {
      method: "POST",
      rel: "execute",
      href: "/compute/sessions/SESSION-ID/jobs",
      type: "application/vnd.sas.compute.job.request",
      responseType: "application/vnd.sas.compute.job",
    });
  });

  it("keeps a null type and omits an absent one", () => {
    // The absent half is finding 14: a link with no media type omits the key,
    // which is how every `delete` link on the deployment arrives. The `null`
    // half is not observed — an earlier reading of the probe that reported
    // `"type": null` on context summaries turned out to be a `jq` artifact —
    // and is pinned here as deliberate breadth, so that a later reader who
    // "corrects" `Link.type` to `string | undefined` fails this test rather
    // than discovering the narrowing on a deployment we cannot see.
    const links = readLinks({
      links: [
        { rel: "delete", href: "/compute/contexts/C", type: null },
        { rel: "update", href: "/compute/contexts/C" },
      ],
    });

    // One assertion covers both halves, because `deepEqual` here is
    // `deepStrictEqual`, which compares own keys: a key holding `undefined` is
    // not equal to a key that is not there. So the second element failing to
    // match `{rel, href}` is exactly the statement that no `type` was invented.
    assert.deepEqual(links, [
      { rel: "delete", href: "/compute/contexts/C", type: null },
      { rel: "update", href: "/compute/contexts/C" },
    ]);
  });

  it("answers with nothing for anything that is not a representation", () => {
    // A response body is whatever `JSON.parse` returned, which is to say
    // anything at all. None of these is a crash.
    for (const value of [
      undefined,
      null,
      "",
      "a string",
      42,
      [],
      {},
      { links: null },
      { links: "self" },
      { links: 7 },
    ]) {
      assert.deepEqual(readLinks(value), [], `for ${JSON.stringify(value)}`);
    }
  });

  it("drops entries that could not be followed anyway", () => {
    // A link with no `rel` cannot be found and one with no `href` cannot be
    // followed, so carrying either forward only moves the failure somewhere
    // with less context.
    const links = readLinks({
      links: [
        { rel: "self", href: "/compute/sessions/S" },
        { href: "/compute/sessions/S/jobs" },
        { rel: "execute" },
        { rel: "", href: "/compute/sessions/S" },
        { rel: "state", href: "" },
        { rel: 7, href: "/compute/sessions/S" },
        { rel: "log", href: ["/compute/sessions/S/log"] },
        null,
        "self",
      ],
    });

    assert.deepEqual(
      links.map((link) => link.rel),
      ["self"],
    );
  });

  it("ignores a method that is not a string", () => {
    // Dropped rather than carried, so `linkMethod` falls back to GET instead of
    // putting a number where a verb goes.
    const links = readLinks({
      links: [{ rel: "self", href: "/compute/sessions/S", method: 7 }],
    });
    assert.deepEqual(links, [{ rel: "self", href: "/compute/sessions/S" }]);
  });
});

describe("findLink", () => {
  const links: readonly Link[] = readLinks({
    links: [
      { rel: "self", href: "/compute/sessions/S", method: "GET" },
      { rel: "execute", href: "/compute/sessions/S/jobs", method: "POST" },
      { rel: "delete", href: "/compute/sessions/S", method: "DELETE" },
    ],
  });

  it("finds a relation", () => {
    assert.equal(findLink(links, "execute")?.href, "/compute/sessions/S/jobs");
  });

  it("distinguishes relations that share an href", () => {
    // `self` and `delete` differ only by method, which is exactly the case
    // upstream's second `getLink(links, method, rel)` exists to handle. One
    // function suffices because `rel` is already unique.
    assert.equal(findLink(links, "self")?.method, "GET");
    assert.equal(findLink(links, "delete")?.method, "DELETE");
  });

  it("answers undefined for a relation that is not there", () => {
    // Not an error: this is how the service says an operation is unavailable in
    // this state, and how an older Viya 4 release says it does not support
    // something at all.
    assert.equal(findLink(links, "cancel"), undefined);
    assert.equal(findLink([], "self"), undefined);
  });

  it("matches the relation exactly", () => {
    assert.equal(findLink(links, "Self"), undefined);
    assert.equal(findLink(links, "sel"), undefined);
    assert.equal(findLink(links, ""), undefined);
  });
});

describe("findLinkOfType", () => {
  /** Finding 44: `/deploymentData`, trimmed to the ambiguous pair. */
  const links: readonly Link[] = readLinks({
    links: [
      {
        rel: "cadenceVersion",
        href: "/deploymentData/cadenceVersion",
        type: "application/vnd.sas.deployment.data.cadence.version",
      },
      {
        rel: "cadenceVersion",
        href: "/deploymentData/appRegistryCadence",
        type: "application/vnd.sas.app.registry.cadence.version",
      },
      { rel: "setinit", href: "/deploymentData/setinit", type: "text/plain" },
    ],
  });

  it("picks the relation with the media type asked for, not the first one", () => {
    // The whole reason this exists. `findLink` takes the first match, and the
    // two hrefs above are identical on the real deployment — so a `rel`-only
    // lookup is right by luck there and wrong here, which is the point of
    // giving the fixture two different hrefs.
    assert.equal(
      findLinkOfType(
        links,
        "cadenceVersion",
        "application/vnd.sas.app.registry.cadence.version",
      )?.href,
      "/deploymentData/appRegistryCadence",
    );
  });

  it("treats the bare and +json spellings as the same type", () => {
    // `computeMediaType`'s rule read backwards: Viya advertises its vendor types
    // bare and serves them suffixed, so a deployment that starts advertising the
    // suffixed form has not changed what it is offering.
    assert.equal(
      findLinkOfType(
        links,
        "cadenceVersion",
        "application/vnd.sas.deployment.data.cadence.version+json",
      )?.href,
      "/deploymentData/cadenceVersion",
    );
  });

  it("ignores parameters and case", () => {
    assert.equal(
      findLinkOfType(
        links,
        "cadenceVersion",
        "Application/VND.SAS.Deployment.Data.Cadence.Version;version=1",
      )?.href,
      "/deploymentData/cadenceVersion",
    );
  });

  it("answers undefined when the relation is there but the type is not", () => {
    // Not the same as the relation being missing, and the caller that cares —
    // the cadence probe — must not read this as "no such relation".
    assert.equal(
      findLinkOfType(links, "cadenceVersion", "application/json"),
      undefined,
    );
  });

  it("answers undefined for a link with no media type at all", () => {
    // Finding 14: a link with no type omits the key entirely, and a `DELETE`
    // link therefore has none. Nothing here may treat that as a wildcard.
    const untyped = readLinks({
      links: [{ rel: "delete", href: "/compute/sessions/S", method: "DELETE" }],
    });
    assert.equal(findLinkOfType(untyped, "delete", "text/plain"), undefined);
    assert.equal(findLinkOfType([], "self", "text/plain"), undefined);
  });

  it("matches the relation exactly, as findLink does", () => {
    assert.equal(
      findLinkOfType(
        links,
        "cadenceversion",
        "application/vnd.sas.deployment.data.cadence.version",
      ),
      undefined,
    );
  });
});

describe("linkMethod", () => {
  it("uses the stated method", () => {
    assert.equal(
      linkMethod({ rel: "execute", href: "/compute/x", method: "POST" }),
      "POST",
    );
  });

  it("falls back to GET", () => {
    assert.equal(linkMethod({ rel: "self", href: "/compute/x" }), "GET");
    assert.equal(
      linkMethod({ rel: "self", href: "/compute/x", method: undefined }),
      "GET",
    );
  });
});

describe("resolveHref", () => {
  const ROOT = "https://viya.example.com";

  it("joins the root to the href the server sent", () => {
    assert.equal(
      resolveHref(ROOT, "/compute/sessions/SESSION-ID/jobs"),
      "https://viya.example.com/compute/sessions/SESSION-ID/jobs",
    );
  });

  it("does not remove the /compute prefix", () => {
    // The whole point of ADR-0010's link navigation. Upstream's
    // `href.replace("/compute", "")` exists because it added the prefix to its
    // base; we never do, so the prefix must survive untouched — including a
    // second occurrence further along, which `String.replace` would have eaten.
    assert.equal(
      resolveHref(
        ROOT,
        "/authorization/rules?filter=eq(objectUri,'%2Fcompute%2Fcontexts%2FC')",
      ),
      "https://viya.example.com/authorization/rules?filter=eq(objectUri,'%2Fcompute%2Fcontexts%2FC')",
    );
  });

  it("re-encodes nothing", () => {
    // `new URL(href, root)` would rewrite the apostrophes above as %27, because
    // they are in the WHATWG query percent-encode set for https. Whatever the
    // server sent is what goes back.
    const awkward = "/compute/sessions/S/jobs?f=a'b&g=c d&h=%2F&i=e+f";
    assert.equal(resolveHref(ROOT, awkward), `${ROOT}${awkward}`);
  });

  it("keeps a root that carries a path prefix", () => {
    // `normaliseEndpoint` in src/profile/model.ts permits a deployment
    // published under a path, so the base is the whole normalised endpoint and
    // not `new URL(endpoint).origin`.
    assert.equal(
      resolveHref("https://gw.example.com/viya", "/compute/sessions/S"),
      "https://gw.example.com/viya/compute/sessions/S",
    );
  });

  it("does not double the slash on a root that kept one", () => {
    assert.equal(
      resolveHref("https://viya.example.com/", "/compute/sessions/S"),
      "https://viya.example.com/compute/sessions/S",
    );
    assert.equal(
      resolveHref("https://viya.example.com///", "/compute/sessions/S"),
      "https://viya.example.com/compute/sessions/S",
    );
  });

  it("refuses an href that names another host", () => {
    // Every request built from a link carries the user's bearer token. An
    // absolute href names the host it goes to, so following one is a request to
    // send that token somewhere else — the same disclosure transport.ts refuses
    // redirects to avoid, and it gets the same answer.
    for (const href of [
      "https://elsewhere.example/collect",
      "http://elsewhere.example/collect",
      "//elsewhere.example/collect",
      "//viya.example.com/compute/sessions/S",
    ]) {
      assert.throws(() => resolveHref(ROOT, href), ForeignLinkError, href);
    }
  });

  it("refuses an href that is not a root-relative path", () => {
    for (const href of [
      "compute/sessions/S",
      "../sessions/S",
      "",
      "?filter=eq(name,'x')",
      "javascript:alert(1)",
    ]) {
      assert.throws(() => resolveHref(ROOT, href), ForeignLinkError, href);
    }
  });

  it("names the href in the failure", () => {
    // The message goes to the log, where the only useful thing to know is what
    // the server actually sent.
    assert.throws(
      () => resolveHref(ROOT, "https://elsewhere.example/collect"),
      /elsewhere\.example/,
    );
  });
});

describe("computeMediaType", () => {
  /** Advertised by a link, and what must go on the wire for it. */
  const cases: readonly (readonly [
    string | null | undefined,
    string | undefined,
  ])[] = [
    // The case the function exists for: Viya advertises its vendor types bare
    // and then requires the structured suffix (finding 14).
    [
      "application/vnd.sas.compute.session",
      "application/vnd.sas.compute.session+json",
    ],
    [
      "application/vnd.sas.compute.session.request",
      "application/vnd.sas.compute.session.request+json",
    ],
    [
      "application/vnd.sas.compute.job.request",
      "application/vnd.sas.compute.job.request+json",
    ],
    [
      "application/vnd.sas.compute.log.line",
      "application/vnd.sas.compute.log.line+json",
    ],
    ["application/vnd.sas.collection", "application/vnd.sas.collection+json"],

    // Already structured — appending again would produce `…+json+json`.
    ["application/vnd.sas.api+json", "application/vnd.sas.api+json"],
    [
      "application/vnd.sas.compute.session+json",
      "application/vnd.sas.compute.session+json",
    ],

    // Not ours to touch. `state` and `getOption` are text/plain links, and
    // `text/plain+json` is not a media type.
    ["text/plain", "text/plain"],
    ["application/json", "application/json"],
    ["application/octet-stream", "application/octet-stream"],
    ["application/vnd.other.thing", "application/vnd.other.thing"],

    // No type to send, so no header to set.
    [null, undefined],
    [undefined, undefined],
    ["", undefined],
    ["   ", undefined],
    [";charset=utf-8", undefined],

    // Parameters survive on whichever side of the rule they land.
    [
      "application/vnd.sas.compute.session;charset=utf-8",
      "application/vnd.sas.compute.session+json;charset=utf-8",
    ],
    [
      "application/vnd.sas.compute.session; charset=utf-8",
      "application/vnd.sas.compute.session+json; charset=utf-8",
    ],
    [
      "application/vnd.sas.compute.session; charset=utf-8; version=2",
      "application/vnd.sas.compute.session+json; charset=utf-8; version=2",
    ],
    ["text/plain; charset=utf-8", "text/plain; charset=utf-8"],
    [
      " application/vnd.sas.compute.session ",
      "application/vnd.sas.compute.session+json",
    ],
  ];

  it("appends +json to exactly the types that need it", () => {
    for (const [advertised, sent] of cases) {
      assert.equal(
        computeMediaType(advertised),
        sent,
        `for ${JSON.stringify(advertised)}`,
      );
    }
  });

  it("is idempotent", () => {
    // The suffix is appended once no matter how many times the value passes
    // through — which is what makes it safe to apply at the point of use rather
    // than tracking whether it has already been applied.
    for (const [advertised] of cases) {
      const once = computeMediaType(advertised);
      assert.equal(computeMediaType(once), once, `for ${String(advertised)}`);
    }
  });

  it("takes no dependency on a media-type parser", () => {
    // ADR-0010: the rule is three predicates, so `media-typer` — which upstream
    // pulls in for this one function — is not in package.json. A test cannot
    // assert the absence of an import, but it can assert the behaviour that
    // would otherwise justify one: a value a strict parser would reject is
    // passed through rather than thrown on.
    assert.equal(computeMediaType("not a media type"), "not a media type");
    assert.equal(computeMediaType("application/"), "application/");
  });
});
