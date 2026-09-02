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
  runAudit: (
    extraArgs?: string[],
    options?: { command?: string; baseArgs?: string[]; timeoutMs?: number },
  ) => unknown;
  needsShell: (command: string) => boolean;
  assertUsableReport: (report: unknown, ran?: string) => unknown;
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

/**
 * `npm audit` is a network call, and CONTRIBUTING.md's rule that every network
 * call has a timeout and an abort path has no carve-out for build tooling. The
 * `supply-chain` job's own `timeout-minutes` would eventually stop a hang, but
 * it stops it as a cancelled job with no explanation, and it does nothing at all
 * for somebody running the command locally.
 *
 * This substitutes a process that is guaranteed never to exit, so the timeout is
 * tested against a real hang rather than against a network failure that has to
 * be waited for and may never arrive.
 */
describe("audit timeout", () => {
  let runAudit: CheckAudit["runAudit"];

  before(async () => {
    ({ runAudit } = await loadScript<CheckAudit>("check-audit.mjs"));
  });

  // `process.execPath` rather than `sleep`, which does not exist on the Windows
  // leg of the matrix. The arguments have to be substituted as well as the
  // command: a node asked to run a file called `audit` fails immediately, which
  // would have made this test pass for entirely the wrong reason.
  const hang = {
    command: process.execPath,
    baseArgs: ["-e", "setTimeout(() => {}, 60_000)"],
    timeoutMs: 250,
  };

  it("gives up on a hung registry instead of waiting forever", () => {
    const started = Date.now();
    assert.throws(
      () => runAudit([], hang),
      /did not finish within 0\.25s and was killed/,
    );
    assert.ok(
      Date.now() - started < 5000,
      "the timeout should end the call, not merely be reported afterwards",
    );
  });

  // The distinction the message draws is the useful part: an unreachable
  // registry is not evidence about the dependency tree, and a build that
  // conflates the two teaches people to re-run it rather than read it.
  it("says the timeout is not a verdict about the tree", () => {
    assert.throws(
      () => runAudit([], hang),
      /not a verdict about the dependency tree/,
    );
  });
});

/**
 * `npm` on Windows is `npm.cmd`, and Node >= 18.20.2 throws `EINVAL` on
 * `execFile` of a `.cmd`/`.bat` without a shell (CVE-2024-27980) — which made
 * `check-audit.mjs` un-runnable there. `runAudit` passes `shell: needsShell(command)`.
 *
 * This pins the decision, not its effect. An integration test cannot tell the
 * arms apart on the Linux CI leg: the `EINVAL` only fires on Windows, and
 * `shell: true` here expands to `sh -c "<command> <args>"`, which needs the same
 * executable, valid command a bare `execFile` does — so no fixture runs one way
 * and not the other. The regression risk the test guards is someone editing the
 * suffix set or the call site, and that lives in `needsShell`.
 */
describe("audit command shell selection", () => {
  let needsShell: CheckAudit["needsShell"];

  before(async () => {
    ({ needsShell } = await loadScript<CheckAudit>("check-audit.mjs"));
  });

  it("shells out for a Windows `.cmd`/`.bat` shim, wherever it resolved from", () => {
    assert.equal(needsShell("npm.cmd"), true);
    assert.equal(needsShell("C:\\Program Files\\nodejs\\npm.cmd"), true);
    assert.equal(needsShell("setup.BAT"), true);
  });

  it("does not shell out for a POSIX command or the tests' node override", () => {
    assert.equal(needsShell("npm"), false);
    assert.equal(needsShell("/usr/local/bin/npm"), false);
    assert.equal(needsShell(process.execPath), false);
  });
});

// A gate that cannot tell "looked and found nothing" from "could not look" is
// worse than no gate, because its silence is believed. The payload below is not
// invented: it is what `npm audit --json --registry=http://127.0.0.1:1` printed,
// and it came with exit code **0**, so neither the status nor the parse can be
// the thing that catches it.
describe("audit failure is not an empty audit", () => {
  let assertUsableReport: CheckAudit["assertUsableReport"];
  let collectAdvisories: CheckAudit["collectAdvisories"];
  let runAudit: CheckAudit["runAudit"];

  before(async () => {
    ({ assertUsableReport, collectAdvisories, runAudit } =
      await loadScript<CheckAudit>("check-audit.mjs"));
  });

  const unreachableRegistry = {
    message:
      "request to http://127.0.0.1:1/-/npm/v1/security/audits/quick failed, " +
      "reason: connect ECONNREFUSED 127.0.0.1:1",
    error: { summary: "", detail: "" },
  };

  it("refuses a report that says the registry was unreachable", () => {
    assert.throws(
      () => assertUsableReport(unreachableRegistry),
      /reported a failure instead of a result/,
    );
  });

  // `error.summary` and `error.detail` were both empty strings in the measured
  // payload, so a message built only from `error` says nothing at all. The text
  // that names the cause lives in `message`.
  it("quotes the reason npm gave", () => {
    assert.throws(
      () => assertUsableReport(unreachableRegistry),
      /ECONNREFUSED 127\.0\.0\.1:1/,
    );
  });

  it("refuses a payload with no vulnerabilities map", () => {
    assert.throws(
      () => assertUsableReport({}),
      /returned no `vulnerabilities` map/,
    );
  });

  it("refuses a null vulnerabilities map", () => {
    assert.throws(
      () => assertUsableReport({ vulnerabilities: null }),
      /returned no `vulnerabilities` map/,
    );
  });

  it("accepts a genuinely clean report", () => {
    const clean = { vulnerabilities: {}, metadata: { vulnerabilities: {} } };
    assert.deepEqual(assertUsableReport(clean), clean);
    assert.deepEqual(collectAdvisories(clean), []);
  });

  // The end-to-end statement of the bug: run something that behaves exactly as
  // the failing `npm audit` did — valid JSON on stdout, exit 0 — and require
  // that `runAudit` refuses it rather than handing back a report that reads as
  // an empty tree.
  it("refuses it through runAudit, where exit 0 offers no warning", () => {
    assert.throws(
      () =>
        runAudit([], {
          command: process.execPath,
          baseArgs: [
            "-e",
            "console.log(JSON.stringify({message:'connect ECONNREFUSED 127.0.0.1:1',error:{summary:'',detail:''}}))",
          ],
        }),
      /reported a failure instead of a result/,
    );
  });
});

// The deny-list in `package.json` is written by hand, and it drifted the first
// time it was written: `fsevents` ships an install script and was left out,
// because it is optional and darwin-only and so never appears in an install on
// the machine the list was written on. Dependabot changes this lockfile most
// weeks. So rather than fix the one entry, assert the property — every package
// that can run code at install time has been decided about, out loud.
describe("install-script policy", () => {
  const lockfile = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package-lock.json"), "utf8"),
  ) as { packages: Record<string, { hasInstallScript?: boolean }> };
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    // `unknown`, not `boolean`: this is untyped JSON read off disk, and the
    // assertion below wants to catch a value that is merely falsy — a `"false"`
    // string, say — rather than trust the annotation.
  ) as { allowScripts?: Record<string, unknown> };

  // Keyed on the package *name*, not the lockfile path: `allowScripts` is keyed
  // by name, and two different paths can share one — this tree has esbuild at
  // both 0.28.2 and 0.21.5, which is why six lockfile entries are five names.
  const installScriptNames = [
    ...new Set(
      Object.entries(lockfile.packages)
        .filter(([, node]) => node.hasInstallScript === true)
        .map(([location]) => location.replace(/^.*node_modules\//, "")),
    ),
  ].sort();

  it("finds the packages that run code at install time", () => {
    assert.ok(
      installScriptNames.length > 0,
      "no install scripts found at all — the lockfile shape probably changed, " +
        "which would make every other assertion here vacuous",
    );
  });

  it("has an explicit decision recorded for every one of them", () => {
    const undecided = installScriptNames.filter(
      (name) => !Object.hasOwn(manifest.allowScripts ?? {}, name),
    );
    assert.deepEqual(
      undecided,
      [],
      "these packages run code at install time and package.json says nothing " +
        "about them; add them to allowScripts",
    );
  });

  // Separate from the test above on purpose. That one guards a property and
  // should never need editing. This one states today's policy — deny everything —
  // and a slice that deliberately allows something is supposed to come here and
  // change it.
  it("denies all of them", () => {
    assert.deepEqual(
      Object.entries(manifest.allowScripts ?? {})
        .filter(([, allowed]) => allowed !== false)
        .map(([name]) => name),
      [],
    );
  });

  it("does not deny packages that are not in the tree", () => {
    const unused = Object.keys(manifest.allowScripts ?? {}).filter(
      (name) => !installScriptNames.includes(name),
    );
    assert.deepEqual(
      unused,
      [],
      "these entries no longer match anything in the lockfile; a stale denial " +
        "reads as coverage it is not providing",
    );
  });
});
