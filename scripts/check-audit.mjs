// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The dependency-advisory gate.
 *
 * Two rules, because the two halves of the tree carry different consequences.
 *
 *   1. **Production: nothing, at any severity.** `npm ls --omit=dev` currently
 *      prints an empty tree — the extension has no runtime dependencies at all
 *      — so this rule cannot fire today. That is the point of writing it now:
 *      it is the gate that starts working on its own the day a runtime
 *      dependency lands, rather than the gate somebody remembers to add
 *      afterwards. There is no allow-list here on purpose. An advisory that can
 *      reach a user is a release decision, not a build-tooling decision.
 *
 *   2. **Development: allow-listed, with an expiry date.** Every advisory in the
 *      dev tree must appear in `advisory-allowlist.json` with a reason and a
 *      date, or the run fails.
 *
 * Rule 2 exists because of what happened in 0d-i-b: adding VitePress took the
 * advisory count from three to six in a single pull request, and nobody found
 * out until days later. A gate on the raw *total* would have ratcheted upward
 * and been switched off within a month; a gate on *unreviewed* advisories fires
 * exactly once per genuinely new thing, which is the only report worth reading.
 *
 * ## Why this blocks a pull request when the weekly link sweep does not
 *
 * `link-check.yml` deliberately never fails a build, on the grounds that a
 * contributor blocked by somebody else's outage learns to re-run the job without
 * reading it. A new advisory arrives on somebody else's timetable too, so the
 * asymmetry is worth defending rather than assuming.
 *
 * The difference is repetition. A rotted external link fails every run until
 * somebody fixes the far end, which may be never — so the same red keeps
 * arriving and stops carrying information. An advisory fails once: the response
 * is a two-line allow-list entry recording the decision and when to look again,
 * after which the gate is quiet. It cries wolf at most once per wolf, and the
 * artefact it leaves behind is a dated, reviewed judgement instead of a
 * re-run button.
 *
 * The honest cost is that an advisory published against an unchanged tree can
 * redden `main` with no commit involved. That is accepted: it is information
 * that genuinely arrived, and the remedy is a small pull request that leaves a
 * record.
 *
 * ## Exit codes
 *
 * **1** — the policy was violated (an unreviewed or expired advisory).
 * **2** — this script or its input is wrong (npm missing, unparseable report,
 * malformed allow-list). Kept distinct because they need different humans:
 * a 1 is a dependency decision, a 2 is a broken checker.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOWLIST = join(HERE, "advisory-allowlist.json");

// npm is a shell shim on Windows; execFile will not find bare `npm` there.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * Flattens an `npm audit --json` report into one entry per distinct advisory.
 *
 * The report is keyed by *package*, and one package can carry several
 * advisories while one advisory can appear under several packages — so neither
 * the package name nor the report's own shape is a usable identity. The GHSA id
 * is, and it is the thing a human can look up, so it is what the allow-list
 * keys on. It is parsed out of the advisory URL because that is where npm puts
 * it; the numeric `source` field is an npm-internal id that no security
 * database will recognise.
 */
export function collectAdvisories(report) {
  const found = new Map();

  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln?.via ?? []) {
      // A string in `via` means "vulnerable only because it depends on that" —
      // the advisory itself is reported under the package it belongs to, so
      // counting these would double-count and invent ids that do not exist.
      if (typeof via !== "object" || via === null) continue;

      const id = ghsaFrom(via.url);
      if (id === undefined) continue;

      if (!found.has(id)) {
        found.set(id, {
          id,
          package: via.name ?? vuln.name ?? "(unknown)",
          severity: via.severity ?? "unknown",
          title: via.title ?? "(no title)",
          url: via.url,
        });
      }
    }
  }

  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Pulls a GHSA identifier out of an advisory URL, or validates a bare one.
 *
 * Both callers matter and they hand it different shapes: `collectAdvisories`
 * passes a full `https://github.com/advisories/GHSA-…` URL, and
 * `parseAllowlist` passes the bare id and checks the answer round-trips. The
 * first draft anchored on a leading `/` and so silently rejected every bare id,
 * which made the entire allow-list unparseable — hence the explicit
 * start-or-slash alternation rather than a bare `\b`.
 */
export function ghsaFrom(url) {
  const match =
    /(?:^|\/)(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})(?:[/?#]|$)/i.exec(
      String(url ?? "").trim(),
    );
  return match === null ? undefined : match[1].toUpperCase();
}

/**
 * Decides what an advisory set plus an allow-list means, as of a given date.
 *
 * `today` is a parameter rather than a `new Date()` inside, so the expiry rules
 * are testable without waiting for time to pass. A checker whose behaviour
 * depends on the wall clock and cannot be asked about a different clock is a
 * checker whose interesting branches are never exercised.
 */
export function classify(advisories, allowlist, today) {
  const byId = new Map(allowlist.map((entry) => [entry.id, entry]));
  const seen = new Set(advisories.map((a) => a.id));

  const unreviewed = [];
  const expired = [];

  for (const advisory of advisories) {
    const entry = byId.get(advisory.id);
    if (entry === undefined) {
      unreviewed.push(advisory);
    } else if (entry.expires < today) {
      expired.push({ ...advisory, expires: entry.expires, why: entry.why });
    }
  }

  // An entry that matches nothing is either a fixed advisory nobody deleted or
  // a typo in an id, and those look identical from here. Both are worth
  // failing on: the first keeps the file honest, and the second is an
  // allow-list line that silently allows nothing.
  const stale = allowlist.filter((entry) => !seen.has(entry.id));

  return { unreviewed, expired, stale };
}

/**
 * Validates the allow-list before trusting it.
 *
 * Every field is load-bearing: a missing `expires` would mean "forever", and a
 * missing `why` produces a file that records decisions without recording any
 * reasoning, which is the failure mode this whole repository is written against.
 */
export function parseAllowlist(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`allow-list is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }

  if (!Array.isArray(raw?.allowed)) {
    throw new Error("allow-list must have an `allowed` array");
  }

  return raw.allowed.map((entry, index) => {
    const where = `allowed[${index}]`;
    if (ghsaFrom(entry?.id) !== entry?.id) {
      throw new Error(
        `${where}.id must be a GHSA identifier, got ${entry?.id}`,
      );
    }
    if (typeof entry.why !== "string" || entry.why.trim() === "") {
      throw new Error(`${where}.why must say why this is accepted`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.expires ?? "")) {
      throw new Error(`${where}.expires must be YYYY-MM-DD`);
    }
    return entry;
  });
}

/**
 * Runs `npm audit --json` and returns the parsed report.
 *
 * npm exits non-zero *because* it found vulnerabilities, which is the normal
 * case here and not an error, so the status is ignored and the payload is what
 * decides. A genuinely broken run is caught by the parse failing instead.
 */
export function runAudit(extraArgs = []) {
  const args = ["audit", "--json", ...extraArgs];
  let stdout;
  try {
    stdout = execFileSync(NPM, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    stdout = error.stdout;
    if (typeof stdout !== "string" || stdout.trim() === "") {
      throw new Error(
        `\`npm ${args.join(" ")}\` produced no report: ${error.message}`,
        { cause: error },
      );
    }
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `\`npm ${args.join(" ")}\` output was not JSON: ${error.message}`,
      { cause: error },
    );
  }
}

/**
 * The rules check themselves.
 *
 * `check-package.mjs` does the same thing and for the same reason: a
 * classifier that stops classifying does not announce itself, it just goes
 * green, and green is exactly what a clean tree also looks like. These cases
 * run on every invocation rather than only under the test runner, because the
 * failure being guarded against is the one where somebody edits this file and
 * does not run the tests.
 */
function selfCheck() {
  const advisory = {
    id: "GHSA-aaaa-bbbb-cccc",
    package: "example",
    severity: "high",
    title: "t",
    url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  };
  const entry = { id: "GHSA-aaaa-bbbb-cccc", why: "w", expires: "2026-12-31" };

  const cases = [
    ["unreviewed", classify([advisory], [], "2026-01-01").unreviewed.length, 1],
    [
      "accepted",
      classify([advisory], [entry], "2026-01-01").unreviewed.length,
      0,
    ],
    ["expired", classify([advisory], [entry], "2027-01-01").expired.length, 1],
    ["stale", classify([], [entry], "2026-01-01").stale.length, 1],
    [
      "ghsa parsed from url",
      ghsaFrom("https://github.com/advisories/GHSA-73rr-hh4g-fpgx"),
      "GHSA-73RR-HH4G-FPGX",
    ],
    ["ghsa bare", ghsaFrom("GHSA-73rr-hh4g-fpgx"), "GHSA-73RR-HH4G-FPGX"],
    [
      "ghsa with trailing slash",
      ghsaFrom("https://github.com/advisories/GHSA-73rr-hh4g-fpgx/"),
      "GHSA-73RR-HH4G-FPGX",
    ],
    ["ghsa absent", ghsaFrom("https://example.test/nope"), undefined],
    ["ghsa malformed", ghsaFrom("GHSA-73rr-hh4g"), undefined],
    [
      "string via ignored",
      collectAdvisories({ vulnerabilities: { a: { via: ["b"] } } }).length,
      0,
    ],
  ];

  const broken = cases.filter(([, actual, expected]) => actual !== expected);
  if (broken.length > 0) {
    for (const [name, actual, expected] of broken) {
      console.error(
        `check-audit: self-check "${name}" expected ${String(expected)}, got ${String(actual)}`,
      );
    }
    process.exit(2);
  }
}

function report(label, items, render) {
  console.error(`\ncheck-audit: ${label}`);
  for (const item of items) console.error(`  ${render(item)}`);
}

function main() {
  selfCheck();

  const today = new Date().toISOString().slice(0, 10);

  let allowlist;
  try {
    allowlist = parseAllowlist(readFileSync(ALLOWLIST, "utf8"));
  } catch (error) {
    console.error(`check-audit: ${error.message}`);
    process.exit(2);
  }

  let production;
  let everything;
  try {
    production = collectAdvisories(runAudit(["--omit=dev"]));
    everything = collectAdvisories(runAudit());
  } catch (error) {
    console.error(`check-audit: ${error.message}`);
    process.exit(2);
  }

  let failed = false;

  // Rule 1. Unconditional, and deliberately not allow-listable.
  if (production.length > 0) {
    report(
      `${production.length} advisory(ies) in the PRODUCTION tree. These reach users; there is no allow-list for them.`,
      production,
      (a) =>
        `${a.id}  ${a.severity.padEnd(8)} ${a.package} — ${a.title}\n    ${a.url}`,
    );
    failed = true;
  }

  // Rule 2. The dev tree, minus anything already reviewed and still in date.
  const productionIds = new Set(production.map((a) => a.id));
  const dev = everything.filter((a) => !productionIds.has(a.id));
  const { unreviewed, expired, stale } = classify(dev, allowlist, today);

  if (unreviewed.length > 0) {
    report(
      `${unreviewed.length} unreviewed advisory(ies) in the dev tree. Decide, then add each to scripts/advisory-allowlist.json with a reason and an expiry date.`,
      unreviewed,
      (a) =>
        `${a.id}  ${a.severity.padEnd(8)} ${a.package} — ${a.title}\n    ${a.url}`,
    );
    failed = true;
  }

  if (expired.length > 0) {
    report(
      `${expired.length} allow-list entry(ies) have expired. Look again: is there a fix now?`,
      expired,
      (a) => `${a.id}  ${a.package} — expired ${a.expires}\n    was: ${a.why}`,
    );
    failed = true;
  }

  if (stale.length > 0) {
    report(
      `${stale.length} allow-list entry(ies) match nothing. Either the advisory is fixed (delete the entry) or the id is wrong (fix it).`,
      stale,
      (e) => `${e.id} — ${e.why}`,
    );
    failed = true;
  }

  if (failed) process.exit(1);

  console.log(
    `check-audit: OK — production tree clean, ${dev.length} dev advisory(ies) all reviewed and in date.`,
  );
}

// Importable for tests without running the gate. `check-package.mjs` and
// `check-links.mjs` use the same guard.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
