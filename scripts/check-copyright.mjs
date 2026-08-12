// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Enforces the licensing obligations recorded in ADR-0000.
 *
 * Two distinct requirements, and the second is the one that is easy to forget:
 *
 *   1. Every source file carries a copyright line and an SPDX identifier.
 *   2. Any file derived from sassoftware/vscode-sas-extension **preserves the
 *      original SAS copyright header AND states that it has been modified.**
 *      Apache-2.0 §4(b) requires the modification notice; preserving the header
 *      alone does not satisfy it. This is a licence obligation, not a courtesy.
 *
 * Adapted in spirit from the upstream extension's check-copyright.mjs, extended
 * with requirement 2.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

const SCAN = [
  { dir: "src", extensions: [".ts"] },
  { dir: "scripts", extensions: [".mjs"] },
  { dir: "test", extensions: [".ts"], skip: ["scratch"] },
];
const ROOT_FILES = ["esbuild.mjs", "eslint.config.mjs"];

// Safety bound on how far we will look for the leading comment block.
const MAX_HEADER_LINES = 60;

const SPDX = /SPDX-License-Identifier:\s*Apache-2\.0/;
const COPYRIGHT = /Copyright\s*(?:©|\(c\)|\(C\))/;
const UPSTREAM = /SAS Institute/i;
const MODIFIED = /Modified\s+(?:from\s+the\s+original|by)\b/i;

/**
 * Returns the leading comment block of a file — everything from the top down to
 * the first line of actual code.
 *
 * Defining the header this way rather than as "the first N lines" matters: a
 * file that merely *discusses* SAS Institute in its body (this script does) is
 * not a ported file, and should not be asked for a modification notice.
 */
function extractHeader(source) {
  const lines = source.split(/\r?\n/, MAX_HEADER_LINES);
  const header = [];
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      header.push(line);
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("//")) {
      header.push(line);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      header.push(line);
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    break; // first line of code — the header is over.
  }

  return header.join("\n");
}

function walk(dir, extensions, skip = []) {
  const absolute = join(ROOT, dir);
  let entries;
  try {
    entries = readdirSync(absolute);
  } catch {
    // A scanned directory need not exist yet — slices add them over time.
    // Deliberately fail-soft: a missing directory is not a licence violation.
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (skip.includes(entry)) continue;
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(join(dir, entry), extensions, skip));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

const files = [
  ...SCAN.flatMap(({ dir, extensions, skip }) => walk(dir, extensions, skip)),
  ...ROOT_FILES.map((f) => join(ROOT, f)),
];

const failures = [];

for (const file of files) {
  let header;
  try {
    header = extractHeader(readFileSync(file, "utf8"));
  } catch {
    continue;
  }

  const name = relative(ROOT, file).split(sep).join("/");

  if (!COPYRIGHT.test(header)) {
    failures.push([
      name,
      "missing a copyright line in its leading comment block",
    ]);
  }
  if (!SPDX.test(header)) {
    failures.push([name, "missing 'SPDX-License-Identifier: Apache-2.0'"]);
  }
  if (UPSTREAM.test(header) && !MODIFIED.test(header)) {
    failures.push([
      name,
      "carries the SAS Institute copyright but no modification notice — Apache-2.0 §4(b) requires ported files to state that they have been changed. Add: 'Modified from the original by the Python on Viya contributors.'",
    ]);
  }
}

if (failures.length > 0) {
  console.error(`\ncheck-copyright: ${failures.length} problem(s) found.\n`);
  for (const [name, reason] of failures) {
    console.error(`  ${name}\n    ${reason}\n`);
  }
  console.error("See docs/adr/0000-repository-licence.md and NOTICE.\n");
  process.exit(1);
}

console.log(`check-copyright: ${files.length} file(s) OK.`);
