// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Checks that the **external** links in the documentation still resolve.
 *
 * Internal links are not checked here. VitePress fails its own build on a dead
 * internal link, so `npm run docs:build` already covers them, and a second tool
 * that has to be taught the same rewrites and anchors would only find ways to
 * disagree with the first.
 *
 * This runs on a schedule, never on a pull request. The web breaks links on its
 * own timetable, and a gate that fails a pull request because somebody else's
 * server had a bad morning is a gate people learn to re-run without reading. A
 * check that cries wolf gets ignored exactly when it is right. The weekly sweep
 * opens an issue instead, which is a thing a human triages rather than a thing
 * standing between them and a merge.
 *
 * Classification, and the distinctions matter more than the count:
 *
 *   - **ok** — a final status below 400 after redirects.
 *   - **broken** — a status at 400+, or a transport error (DNS failure, refused
 *     connection, timeout), that survived a retry. Fails the run.
 *   - **unverified** — 403 or 429. These are the two answers that a working
 *     link gives when the far end dislikes a datacentre IP, and they are
 *     reported, counted, and *not* failed: a checker that calls Cloudflare's
 *     bot page a dead link teaches its reader to disbelieve the whole report.
 *   - **skipped** — matched a SKIP pattern below.
 *
 * Transport errors count as broken and 403 does not, which looks backwards
 * until you ask which one a *working* link produces. A live site answers; a
 * retired domain does not resolve. Getting this the other way round — the
 * first draft did — means a domain that has vanished entirely is filed under
 * "probably fine" and the sweep passes forever.
 *
 * Usage: node scripts/check-links.mjs [path ...]
 *
 * With no arguments it sweeps `docs/` and the repository's root markdown files.
 * Paths may be files or directories, which is what makes the checker itself
 * testable against a fixture rather than only against the live internet.
 *
 * Exit codes: **1** means at least one link is broken; **2** means the script
 * could not run the check at all.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_TARGETS = [
  "docs",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
];

/**
 * Links that are not meant to be fetched.
 *
 * `example.com` and friends are RFC 2606 placeholders; a Viya hostname in a doc
 * is an illustration of a shape, not somebody's deployment; and a URL carrying
 * `<id>` or `${…}` is a template that would 404 by construction. Fetching any
 * of these produces a failure that is always wrong, which is the fastest way to
 * make the whole report worthless.
 */
const SKIP = [
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i,
  /^https?:\/\/([^/]+\.)?example\.(com|org|net)(:|\/|$)/i,
  /[<>]|\$\{/,
];

const CONCURRENCY = 6;
const TIMEOUT_MS = 20000;

// Some servers answer a bare fetch with 403 and a real browser with 200. This
// is not an attempt to disguise the checker — the URL says what it is — but a
// default agent string is a reliable way to collect false breakage reports.
const HEADERS = {
  "user-agent":
    "python-on-viya-link-check/1.0 (+https://github.com/Shai-Alit/sas-py-vscode)",
  accept: "*/*",
};

function markdownFiles(target) {
  // `resolve`, not `join`: an absolute path on the command line must stay
  // absolute, which is what lets this script be pointed at a fixture directory
  // instead of only at the repository it lives in.
  const absolute = resolve(ROOT, target);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    // A target need not exist yet — slices add documents over time, and a
    // missing CHANGELOG is not a broken link.
    return [];
  }
  if (!stats.isDirectory()) {
    return absolute.endsWith(".md") ? [absolute] : [];
  }
  const found = [];
  for (const entry of readdirSync(absolute)) {
    if (entry === "cache" || entry === "dist" || entry === "node_modules") {
      continue;
    }
    found.push(...markdownFiles(join(absolute, entry)));
  }
  return found;
}

/**
 * External URLs in a markdown document, with the line each was found on.
 *
 * Three forms are recognised: inline `[text](url)`, reference definitions
 * `[label]: url`, and autolinks `<url>`. Bare URLs in prose are deliberately
 * not matched — they are not links, and the trailing punctuation of a sentence
 * is not part of a URL, which is a distinction a regex loses.
 */
export function extractLinks(markdown) {
  const patterns = [
    /\]\(\s*(https?:\/\/[^\s)]+?)\s*(?:"[^"]*")?\s*\)/g,
    /^\s*\[[^\]]+\]:\s*(https?:\/\/\S+)\s*$/gm,
    /<(https?:\/\/[^\s>]+)>/g,
  ];

  const found = [];
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const url = match[1];
      // The line number is derived from the offset rather than tracked, so the
      // three patterns do not each need their own line-counting loop.
      const line = markdown.slice(0, match.index).split(/\r?\n/).length;
      found.push({ url, line });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/** One request, following redirects, HEAD with a GET fallback. */
async function probe(url) {
  // Plenty of servers do not implement HEAD and answer 403/405/501 to it while
  // serving GET perfectly well. HEAD first anyway: it is the cheap question,
  // and the fallback costs one extra request only on the servers that need it.
  for (const method of ["HEAD", "GET"]) {
    let response;
    try {
      response = await fetch(url, {
        method,
        redirect: "follow",
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { state: "error", detail: error.message };
    }
    if (method === "HEAD" && [403, 405, 429, 501].includes(response.status)) {
      continue;
    }
    return { state: "status", status: response.status };
  }
  return { state: "error", detail: "unreachable" };
}

async function classify(url) {
  let last = await probe(url);

  // A single retry, and only for the failures that are plausibly transient. A
  // 404 is not going to change its mind, and retrying it just makes the sweep
  // slower for no new information.
  const transient =
    last.state === "error" ||
    (last.state === "status" && (last.status === 429 || last.status >= 500));
  if (transient) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    last = await probe(url);
  }

  if (last.state === "error") {
    return { verdict: "broken", detail: `no response — ${last.detail}` };
  }
  if (last.status === 403 || last.status === 429) {
    return {
      verdict: "unverified",
      detail: `HTTP ${last.status} — the server answered, but refused this client`,
    };
  }
  if (last.status >= 400) {
    return { verdict: "broken", detail: `HTTP ${last.status}` };
  }
  return { verdict: "ok", detail: `HTTP ${last.status}` };
}

/** Runs `worker` over `items`, at most `limit` at a time. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function main() {
  const targets = process.argv.slice(2);
  const files = (targets.length > 0 ? targets : DEFAULT_TARGETS)
    .flatMap((target) => markdownFiles(target))
    .sort();

  if (files.length === 0) {
    console.error("check-links: no markdown files to check.");
    process.exit(2);
  }

  // Deduplicated by URL, because the same link appears in several documents and
  // the far end does not need to hear about it once per mention. Every location
  // is kept so the report can name all of them.
  const byUrl = new Map();
  let skipped = 0;

  for (const file of files) {
    for (const { url, line } of extractLinks(readFileSync(file, "utf8"))) {
      if (SKIP.some((pattern) => pattern.test(url))) {
        skipped++;
        continue;
      }
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl
        .get(url)
        .push(`${relative(ROOT, file).split(/[\\/]/).join("/")}:${line}`);
    }
  }

  const urls = [...byUrl.keys()].sort();
  if (urls.length === 0) {
    // Said plainly. A sweep that checked nothing must not read like a sweep
    // that found nothing wrong — that is the failure mode of every link
    // checker that has ever been pointed at the wrong directory.
    console.error(
      `check-links: found no external links in ${files.length} file(s). ` +
        "That is almost certainly wrong; check the paths passed in.",
    );
    process.exit(2);
  }

  const verdicts = await pool(urls, CONCURRENCY, async (url) => ({
    url,
    ...(await classify(url)),
  }));

  const broken = verdicts.filter((v) => v.verdict === "broken");
  const unverified = verdicts.filter((v) => v.verdict === "unverified");

  for (const group of [
    ["broken", broken],
    ["unverified", unverified],
  ]) {
    const [label, entries] = group;
    if (entries.length === 0) continue;
    console.log(`\n${label}:\n`);
    for (const entry of entries) {
      console.log(`  ${entry.url}`);
      console.log(`    ${entry.detail}`);
      for (const where of byUrl.get(entry.url)) console.log(`    ${where}`);
    }
  }

  const summary =
    `check-links: ${urls.length} external link(s) across ${files.length} file(s) — ` +
    `${verdicts.length - broken.length - unverified.length} ok, ` +
    `${broken.length} broken, ${unverified.length} unverified, ${skipped} skipped.`;

  if (broken.length > 0) {
    console.error(`\n${summary}`);
    process.exit(1);
  }
  console.log(`\n${summary}`);
}

if (process.argv[1] && process.argv[1].endsWith("check-links.mjs")) {
  await main();
}
