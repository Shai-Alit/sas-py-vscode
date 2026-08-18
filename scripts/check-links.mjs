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
 *   - **skipped** — matched a SKIP pattern below, or is a GitHub feature URL
 *     belonging to this repository (`/commits/main`, `/security/advisories/new`)
 *     for which there is nothing on disk to compare and nothing useful to fetch.
 *
 * Links into **this** repository are not fetched at all. They are resolved
 * against the working tree instead — see `selfLinkTarget` for why that is both
 * necessary (GitHub 404s a private repository, so every self-link reads as
 * broken to an anonymous client) and better (exact, offline, and safe to run on
 * a pull request). `--self-only` runs that half by itself.
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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/**
 * This repository's own `github.com` URLs, read from `package.json` rather than
 * written down here, so a rename or a fork cannot quietly turn every self-link
 * into an unchecked one.
 */
const REPOSITORY = /github\.com\/(.+?)(?:\.git)?$/.exec(
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).repository
    ?.url ?? "",
)?.[1];

/** True for any URL pointing back at this repository on GitHub. */
export function isSelfLink(url, repository) {
  return (
    Boolean(repository) && url.startsWith(`https://github.com/${repository}/`)
  );
}

/**
 * The repository-relative path a `…/blob/<ref>/<path>` self-link names, or
 * `null` if the URL is not that shape.
 *
 * Self-links are checked against the **working tree**, never over HTTP, and the
 * reason is worth stating because it is not obvious. **GitHub answers 404, not
 * 403, for a private repository.** While this repo is private every self-link
 * therefore reads as broken to an anonymous client — the first live run of this
 * script reported five, all of them fine — and "403 means unverified" does not
 * catch it. A weekly report that is five-sixths false on its first outing is
 * the exact wolf-crying this script's own header argues against.
 *
 * Checking the filesystem is better than fixing the classification, though.
 * It is exact rather than probabilistic, it needs no network, and it can run on
 * every pull request — so a link to a file this repository renames is caught by
 * the pull request that renames it, instead of by a sweep the following Monday.
 */
export function selfLinkTarget(url, repository) {
  const prefix = `https://github.com/${repository}/blob/`;
  if (!repository || !url.startsWith(prefix)) return null;
  const afterRef = url.slice(prefix.length).indexOf("/");
  if (afterRef === -1) return null;
  // A fragment or query names a place within the file, not a different file.
  const path = url
    .slice(prefix.length + afterRef + 1)
    .split(/[?#]/)[0]
    .trim();
  return path.length > 0 ? path : null;
}

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
 * The destination of every inline `[text](url)` link.
 *
 * Scanned character by character rather than matched with a regex, because the
 * rule that matters here is not a regular one. CommonMark §6.5 allows
 * parentheses inside a link destination provided they are **balanced**, so in
 *
 *     [wiki](https://en.wikipedia.org/wiki/Unix_(computing))
 *
 * the destination ends at the *second* closing parenthesis, and every renderer
 * these documents will be read in agrees. The `[^\s)]+` pattern this replaced
 * stopped at the first one, truncating that URL to `…/Unix_(computing` — a page
 * that has never existed — and would then have reported a working link as
 * broken every Monday until somebody stopped reading the report. Disbelieving
 * the report is how a scheduled check dies, so a false alarm here costs more
 * than a miss.
 */
function* inlineLinks(markdown) {
  for (const opener of markdown.matchAll(/\]\(\s*/g)) {
    const start = opener.index + opener[0].length;
    // "https://" is the longest prefix worth looking at; a relative
    // destination is VitePress's problem, not this script's.
    if (!/^https?:\/\//.test(markdown.slice(start, start + 8))) continue;

    let depth = 0;
    let end = -1;
    for (let i = start; i < markdown.length; i++) {
      const character = markdown[i];
      // A backslash takes the next character with it whatever it is, so an
      // escaped `\)` belongs to the URL rather than ending it.
      if (character === "\\") {
        i++;
      } else if (character === "(") {
        depth++;
      } else if (character === ")") {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      } else if (/\s/.test(character)) {
        end = i;
        break;
      }
    }

    // No closing parenthesis, or parentheses that never balanced. CommonMark
    // does not call this a link either, so neither does the report.
    if (end === -1) continue;

    // Whitespace ended the destination, which means an optional title stands
    // between here and the `)`. Insist on that `)`: without it this is prose
    // that happens to contain `](`, and dragging prose into a weekly report is
    // the same false-alarm problem in a different coat.
    if (
      markdown[end] !== ")" &&
      !/^\s*(?:"[^"]*"|'[^']*'|\([^)]*\))?\s*\)/.test(markdown.slice(end))
    ) {
      continue;
    }

    yield {
      // Unescaped, because `\(` addresses the same resource as `(` and the
      // server is being asked for the resource, not for the markdown.
      url: markdown.slice(start, end).replace(/\\([()])/g, "$1"),
      index: start,
    };
  }
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
  const found = [...inlineLinks(markdown)];

  const patterns = [
    /^\s*\[[^\]]+\]:\s*(https?:\/\/\S+)\s*$/gm,
    /<(https?:\/\/[^\s>]+)>/g,
  ];
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      found.push({ url: match[1], index: match.index });
    }
  }

  // Sorted by offset rather than by line, and certainly not left in the order
  // the passes produced: each form is found by a separate sweep of the whole
  // document, so without this every autolink would be reported after every
  // inline link regardless of where the reader will look for it.
  return found
    .sort((a, b) => a.index - b.index)
    .map(({ url, index }) => ({
      url,
      // Derived from the offset rather than tracked, so no pass needs its own
      // line-counting loop.
      line: markdown.slice(0, index).split(/\r?\n/).length,
    }));
}

/** One request, following redirects, HEAD with a GET fallback. */
async function probe(url) {
  // Plenty of servers do not implement HEAD and answer 403/405/501 to it while
  // serving GET perfectly well. HEAD first anyway: it is the cheap question,
  // and the fallback costs one extra request only on the servers that need it.
  //
  // **404 is in that list, which looks wrong and is not.** The Visual Studio
  // Marketplace answers `404` to a HEAD of an extension page it serves `200` for
  // on GET — measured 2026-08-18 against the SAS extension's item URL, the only
  // marketplace link this repository carries. Taking a HEAD `404` as final
  // reported a live page as broken. Retrying costs one request on genuinely
  // missing pages and changes no verdict: a URL that is 404 on both methods is
  // still reported 404, because it is the *second* answer that is returned.
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
    if (
      method === "HEAD" &&
      [403, 404, 405, 429, 501].includes(response.status)
    ) {
      continue;
    }
    return { state: "status", status: response.status };
  }
  return { state: "error", detail: "unreachable" };
}

async function classify(url) {
  let last = await probe(url);

  // A single retry, and only for the failures that are plausibly transient. A
  // 404 that already survived `probe`'s GET fallback is not going to change its
  // mind, and retrying it just makes the sweep slower for no new information.
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
  // `--self-only` runs the offline half and stops: no network, so it is safe to
  // put in front of a pull request, which is where a self-link belongs.
  const selfOnly = process.argv.includes("--self-only");
  const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
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
  const selfFailures = [];
  let selfChecked = 0;
  let skipped = 0;

  for (const file of files) {
    const where = `${relative(ROOT, file).split(/[\\/]/).join("/")}`;
    for (const { url, line } of extractLinks(readFileSync(file, "utf8"))) {
      if (isSelfLink(url, REPOSITORY)) {
        const target = selfLinkTarget(url, REPOSITORY);
        if (target === null) {
          // A GitHub feature rather than a file — `/commits/main`,
          // `/security/advisories/new`. There is nothing on disk to compare it
          // against and nothing useful to fetch, so it is skipped and said so.
          skipped++;
          continue;
        }
        selfChecked++;
        if (!existsSync(join(ROOT, target))) {
          selfFailures.push(
            `${where}:${line} — ${url}\n    no such file: ${target}`,
          );
        }
        continue;
      }
      if (SKIP.some((pattern) => pattern.test(url))) {
        skipped++;
        continue;
      }
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push(`${where}:${line}`);
    }
  }

  if (selfFailures.length > 0) {
    console.error(
      "\ncheck-links: links into this repository name files that do not exist.\n\n" +
        selfFailures.map((f) => `  ${f}`).join("\n") +
        "\n\nThese are checked against the working tree, not over HTTP — see the\n" +
        "comment on selfLinkTarget. Fix the link, or the rename that broke it.",
    );
    process.exit(1);
  }

  if (selfOnly) {
    console.log(
      `check-links: ${selfChecked} link(s) into this repository resolve to a real file.`,
    );
    return;
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
    `${broken.length} broken, ${unverified.length} unverified, ${skipped} skipped; ` +
    `${selfChecked} self-link(s) resolved against the working tree.`;

  if (broken.length > 0) {
    console.error(`\n${summary}`);
    process.exit(1);
  }
  console.log(`\n${summary}`);
}

if (process.argv[1] && process.argv[1].endsWith("check-links.mjs")) {
  await main();
}
