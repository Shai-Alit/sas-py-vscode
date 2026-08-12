// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { loadScript } from "../helpers/load-script";

interface Advisory {
  id: string;
  package: string;
  severity: string;
  title: string;
  url: string;
}

interface AllowlistEntry {
  id: string;
  why: string;
  expires: string;
}

// Property signatures rather than methods, for the same reason as
// docs-samples.test.ts: these are plain functions read off a module namespace.
interface CheckAudit {
  collectAdvisories: (report: unknown) => Advisory[];
  ghsaFrom: (url: unknown) => string | undefined;
  classify: (
    advisories: Advisory[],
    allowlist: AllowlistEntry[],
    today: string,
  ) => {
    unreviewed: Advisory[];
    expired: (Advisory & { expires: string })[];
    stale: AllowlistEntry[];
  };
  parseAllowlist: (text: string) => AllowlistEntry[];
}

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function advisory(id: string, extra: Partial<Advisory> = {}): Advisory {
  return {
    id,
    package: "example",
    severity: "moderate",
    title: "t",
    url: `https://github.com/advisories/${id}`,
    ...extra,
  };
}

function entry(id: string, expires: string): AllowlistEntry {
  return { id, why: "reviewed", expires };
}

/**
 * The advisory gate behind the `supply-chain` CI job.
 *
 * These tests lean hard on the identity question — which advisory *is* this —
 * because that is where the first version was wrong in a way that produced a
 * confident, plausible, incorrect answer. `npm audit` is keyed by package, and
 * its headline count is packages too: on 2026-08-12 it reported "6
 * vulnerabilities" over 7 distinct GHSAs, because three separate vite
 * advisories collapse into a single line of its human-readable output. An
 * allow-list keyed on anything but the GHSA id would therefore have silenced
 * advisories nobody had read.
 */
describe("advisory identity", () => {
  let collectAdvisories: CheckAudit["collectAdvisories"];
  let ghsaFrom: CheckAudit["ghsaFrom"];

  before(async () => {
    ({ collectAdvisories, ghsaFrom } =
      await loadScript<CheckAudit>("check-audit.mjs"));
  });

  it("reads the identifier out of an advisory URL", () => {
    assert.equal(
      ghsaFrom("https://github.com/advisories/GHSA-73rr-hh4g-fpgx"),
      "GHSA-73RR-HH4G-FPGX",
    );
  });

  // Both callers hand this different shapes: collectAdvisories passes a URL,
  // parseAllowlist passes a bare id and checks the answer round-trips. The
  // first version anchored on a leading slash, so every bare id came back
  // undefined and the whole allow-list was rejected as malformed.
  it("accepts a bare identifier, so the allow-list can be validated with it", () => {
    assert.equal(ghsaFrom("GHSA-73rr-hh4g-fpgx"), "GHSA-73RR-HH4G-FPGX");
  });

  it("tolerates a trailing slash on the URL", () => {
    assert.equal(
      ghsaFrom("https://github.com/advisories/GHSA-73rr-hh4g-fpgx/"),
      "GHSA-73RR-HH4G-FPGX",
    );
  });

  it("normalises case, so the file and the registry can disagree", () => {
    assert.equal(ghsaFrom("ghsa-73rr-hh4g-fpgx"), "GHSA-73RR-HH4G-FPGX");
  });

  it("returns nothing for a URL with no advisory in it", () => {
    assert.equal(ghsaFrom("https://example.test/nope"), undefined);
    assert.equal(ghsaFrom(undefined), undefined);
  });

  it("rejects a truncated identifier rather than half-matching it", () => {
    assert.equal(ghsaFrom("GHSA-73rr-hh4g"), undefined);
  });

  it("reports one entry per advisory even when several packages carry it", () => {
    const url = "https://github.com/advisories/GHSA-aaaa-bbbb-cccc";
    const found = collectAdvisories({
      vulnerabilities: {
        alpha: {
          name: "alpha",
          via: [{ name: "alpha", url, severity: "high" }],
        },
        beta: { name: "beta", via: [{ name: "alpha", url, severity: "high" }] },
      },
    });
    assert.deepEqual(
      found.map((a) => a.id),
      ["GHSA-AAAA-BBBB-CCCC"],
    );
  });

  it("reports several entries when one package carries several advisories", () => {
    const found = collectAdvisories({
      vulnerabilities: {
        alpha: {
          name: "alpha",
          via: [
            { name: "alpha", url: "https://x/GHSA-aaaa-bbbb-cccc" },
            { name: "alpha", url: "https://x/GHSA-dddd-eeee-ffff" },
          ],
        },
      },
    });
    assert.deepEqual(
      found.map((a) => a.id),
      ["GHSA-AAAA-BBBB-CCCC", "GHSA-DDDD-EEEE-FFFF"],
    );
  });

  // A string in `via` means "vulnerable because of a dependency" and names that
  // dependency; the advisory itself is reported under the package it belongs
  // to. Counting these would double-count. This pins the outcome rather than
  // the mechanism, and deliberately so: deleting the `typeof via === "object"`
  // guard does not fail this test, because a package name is not a GHSA
  // identifier and falls out at the next step anyway. The guard stays as a
  // statement of intent, but the behaviour is what is being guaranteed here.
  it("ignores the string form of `via`, which names a package not an advisory", () => {
    assert.deepEqual(
      collectAdvisories({ vulnerabilities: { mocha: { via: ["diff"] } } }),
      [],
    );
  });

  it("survives an empty or shapeless report instead of throwing", () => {
    assert.deepEqual(collectAdvisories({}), []);
    assert.deepEqual(collectAdvisories(undefined), []);
    assert.deepEqual(collectAdvisories({ vulnerabilities: {} }), []);
  });
});

describe("advisory allow-list decisions", () => {
  let classify: CheckAudit["classify"];

  before(async () => {
    ({ classify } = await loadScript<CheckAudit>("check-audit.mjs"));
  });

  it("fails an advisory nobody has written down", () => {
    const { unreviewed } = classify(
      [advisory("GHSA-AAAA-BBBB-CCCC")],
      [],
      "2026-08-12",
    );
    assert.deepEqual(
      unreviewed.map((a) => a.id),
      ["GHSA-AAAA-BBBB-CCCC"],
    );
  });

  it("passes an advisory that has been reviewed and is in date", () => {
    const result = classify(
      [advisory("GHSA-AAAA-BBBB-CCCC")],
      [entry("GHSA-AAAA-BBBB-CCCC", "2026-12-31")],
      "2026-08-12",
    );
    assert.deepEqual(result.unreviewed, []);
    assert.deepEqual(result.expired, []);
    assert.deepEqual(result.stale, []);
  });

  it("fails an entry whose expiry has passed", () => {
    const { expired } = classify(
      [advisory("GHSA-AAAA-BBBB-CCCC")],
      [entry("GHSA-AAAA-BBBB-CCCC", "2026-08-11")],
      "2026-08-12",
    );
    assert.deepEqual(
      expired.map((a) => ({ id: a.id, expires: a.expires })),
      [{ id: "GHSA-AAAA-BBBB-CCCC", expires: "2026-08-11" }],
    );
  });

  // The boundary is worth pinning down because both readings are defensible and
  // only one of them is implemented: an entry is good *through* its expiry date,
  // not up to the day before it.
  it("treats an entry as valid on its expiry date itself", () => {
    const { expired } = classify(
      [advisory("GHSA-AAAA-BBBB-CCCC")],
      [entry("GHSA-AAAA-BBBB-CCCC", "2026-08-12")],
      "2026-08-12",
    );
    assert.deepEqual(expired, []);
  });

  // An entry matching nothing is either an advisory that got fixed and was
  // never cleaned up, or a typo in an id — a line that silently allows nothing.
  // Those are indistinguishable from here and both deserve a failure.
  it("fails an entry that matches no advisory", () => {
    const { stale } = classify(
      [],
      [entry("GHSA-AAAA-BBBB-CCCC", "2026-12-31")],
      "2026-08-12",
    );
    assert.equal(stale.length, 1);
  });

  it("keeps the three verdicts independent", () => {
    const result = classify(
      [advisory("GHSA-1111-1111-1111"), advisory("GHSA-2222-2222-2222")],
      [
        entry("GHSA-2222-2222-2222", "2020-01-01"),
        entry("GHSA-3333-3333-3333", "2030-01-01"),
      ],
      "2026-08-12",
    );
    assert.deepEqual(
      result.unreviewed.map((a) => a.id),
      ["GHSA-1111-1111-1111"],
    );
    assert.deepEqual(
      result.expired.map((a) => a.id),
      ["GHSA-2222-2222-2222"],
    );
    assert.deepEqual(
      result.stale.map((e) => e.id),
      ["GHSA-3333-3333-3333"],
    );
  });
});

describe("advisory allow-list parsing", () => {
  let parseAllowlist: CheckAudit["parseAllowlist"];

  before(async () => {
    ({ parseAllowlist } = await loadScript<CheckAudit>("check-audit.mjs"));
  });

  it("accepts a well-formed file", () => {
    const parsed = parseAllowlist(
      JSON.stringify({
        allowed: [
          { id: "GHSA-AAAA-BBBB-CCCC", why: "because", expires: "2026-12-31" },
        ],
      }),
    );
    assert.equal(parsed.length, 1);
  });

  it("rejects an entry with no reason, which is the whole point of the file", () => {
    assert.throws(
      () =>
        parseAllowlist(
          JSON.stringify({
            allowed: [
              { id: "GHSA-AAAA-BBBB-CCCC", why: "  ", expires: "2026-12-31" },
            ],
          }),
        ),
      /why must say why/,
    );
  });

  // A missing expiry would read as "forever", which is the failure mode an
  // allow-list is most prone to. It has to be a parse error, not a default.
  it("rejects an entry with no expiry rather than defaulting to forever", () => {
    assert.throws(
      () =>
        parseAllowlist(
          JSON.stringify({
            allowed: [{ id: "GHSA-AAAA-BBBB-CCCC", why: "because" }],
          }),
        ),
      /expires must be YYYY-MM-DD/,
    );
  });

  it("rejects an identifier that is not a GHSA", () => {
    assert.throws(
      () =>
        parseAllowlist(
          JSON.stringify({
            allowed: [
              { id: "CVE-2026-1234", why: "because", expires: "2026-12-31" },
            ],
          }),
        ),
      /must be a GHSA identifier/,
    );
  });

  it("rejects a file with no `allowed` array", () => {
    assert.throws(
      () => parseAllowlist(JSON.stringify({})),
      /must have an `allowed` array/,
    );
  });

  it("reports unparseable JSON as such", () => {
    assert.throws(() => parseAllowlist("{nope"), /not valid JSON/);
  });

  // The committed file is the one that actually runs, and a checker that only
  // ever validates synthetic input has never validated anything that ships.
  it("accepts the allow-list this repository actually commits", () => {
    const text = readFileSync(
      path.join(REPO_ROOT, "scripts", "advisory-allowlist.json"),
      "utf8",
    );
    const parsed = parseAllowlist(text);
    assert.ok(
      parsed.length > 0,
      "the committed allow-list should not be empty",
    );
  });
});
