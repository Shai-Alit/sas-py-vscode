// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Generates the settings and command reference from `package.json`.
 *
 * The contribution points in `package.json` are the only authority on what
 * settings and commands exist — VS Code reads them, not the docs. A hand-typed
 * table is therefore a second copy of a machine-readable fact, and the failure
 * mode is silent: nothing breaks when the copy goes stale, it just starts lying.
 * Same reasoning as the test anti-goal in PRODUCTION_PLAN.md §4.
 *
 * Output is **committed**, not git-ignored. That is deliberate (§4.1): a pull
 * request that renames a command then shows the reviewer that rename, instead
 * of hiding it behind a build step nobody runs during review, and the tables
 * stay readable on GitHub without building the site.
 *
 * Usage:
 *   node scripts/generate-reference.mjs            # write the files
 *   node scripts/generate-reference.mjs --check    # fail if they are stale
 *
 * `--check` regenerates in memory and compares against what is on disk. It
 * deliberately does not shell out to `git diff`: that would report a false
 * failure for anyone with unrelated uncommitted work, and a false pass in a
 * checkout where the files were never committed at all.
 *
 * Exit codes match scripts/check-package.mjs: **1** means the committed output
 * is stale and should be regenerated; **2** means the input is wrong — an
 * unresolvable `%placeholder%`, or a `package.json` this cannot read.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "reference");

const BANNER = `<!--
  GENERATED FILE — DO NOT EDIT.

  Produced by scripts/generate-reference.mjs from package.json.
  Run \`npm run docs:reference\` after changing a contribution point, and commit
  the result. CI fails if this file does not match what package.json produces.
-->
`;

/**
 * Resolves a `%key%` placeholder through `package.nls.json`.
 *
 * An unresolved placeholder is not a cosmetic problem: VS Code renders the raw
 * `%command.foo.title%` in the command palette, so a missing key is a visible
 * defect that no type checker catches. Failing here is the earliest anything
 * can notice it.
 *
 * It throws rather than exiting. `build` is the seam the tests use, and a
 * function that calls `process.exit` cannot be tested — asserting on the one
 * failure mode that matters would kill the test runner instead. `main` turns
 * the throw back into exit code 2.
 */
function makeResolver(nls) {
  return function resolve(value, where) {
    if (typeof value !== "string") return value;
    const match = /^%(.+)%$/.exec(value);
    if (!match) return value;
    const key = match[1];
    if (!Object.hasOwn(nls, key)) {
      throw new Error(
        `${where} references %${key}%, which is not in package.nls.json. ` +
          "VS Code renders an unresolved placeholder literally in the UI, so this would ship as visible text.",
      );
    }
    return nls[key];
  };
}

/**
 * Escapes a value for a markdown table cell. Pipes end the cell and newlines
 * end the row, so a description containing either would silently corrupt the
 * table rather than fail.
 */
function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function code(text) {
  return `\`${String(text)}\``;
}

/**
 * Renders a JSON schema default the way a user would type it into settings.json,
 * rather than the way JavaScript prints it: `""` for an empty string rather than
 * nothing at all, and `{}` rather than `[object Object]`.
 */
function renderDefault(value) {
  if (value === undefined) return "—";
  return code(JSON.stringify(value));
}

function renderType(schema) {
  const type = schema.type ?? "any";
  return code(Array.isArray(type) ? type.join(" \\| ") : type);
}

function describe(schema, resolve, where) {
  const raw =
    schema.markdownDescription ?? schema.description ?? "*(undocumented)*";
  return resolve(raw, where);
}

function generateSettings(pkg, resolve) {
  const configuration = pkg.contributes?.configuration;
  // A single object today; VS Code also accepts an array of categories, and
  // treating both the same way here means adding one later is not a code change.
  const blocks = Array.isArray(configuration)
    ? configuration
    : configuration
      ? [configuration]
      : [];

  const restricted = new Set(
    pkg.capabilities?.untrustedWorkspaces?.restrictedConfigurations ?? [],
  );

  const lines = [
    BANNER,
    "# Settings",
    "",
    `Every setting contributed by **${pkg.displayName}**, generated from \`package.json\`.`,
    "",
  ];

  let anyRestricted = false;

  for (const block of blocks) {
    const title = resolve(block.title, "contributes.configuration.title");
    if (blocks.length > 1) lines.push(`## ${title}`, "");

    const properties = Object.entries(block.properties ?? {});
    if (properties.length === 0) {
      lines.push("*No settings are contributed yet.*", "");
      continue;
    }

    lines.push("| Setting | Type | Default | Scope | Description |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const [name, schema] of properties) {
      const isRestricted = restricted.has(name);
      if (isRestricted) anyRestricted = true;
      const description =
        describe(schema, resolve, `contributes.configuration.${name}`) +
        (isRestricted ? " †" : "");
      lines.push(
        `| ${code(name)} | ${renderType(schema)} | ${renderDefault(schema.default)} | ${code(schema.scope ?? "window")} | ${cell(description)} |`,
      );
    }
    lines.push("");
  }

  if (anyRestricted) {
    lines.push(
      "† **Restricted in untrusted workspaces.** The workspace-scoped value is ignored",
      "until you trust the folder, because acting on it would run code on a remote",
      "server under your identity. See",
      "[ADR-0002](../adr/0002-workspace-trust-posture.md).",
      "",
    );
  }

  return lines.join("\n");
}

function generateCommands(pkg, resolve) {
  const commands = pkg.contributes?.commands ?? [];

  const lines = [
    BANNER,
    "# Commands",
    "",
    `Every command contributed by **${pkg.displayName}**, generated from \`package.json\`.`,
    "Commands are invoked from the Command Palette (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>)",
    "under their category.",
    "",
  ];

  if (commands.length === 0) {
    lines.push("*No commands are contributed yet.*", "");
    return lines.join("\n");
  }

  lines.push("| Command | Palette entry | ID |");
  lines.push("| --- | --- | --- |");
  for (const command of commands) {
    const where = `contributes.commands.${command.command}`;
    const title = resolve(command.title, `${where}.title`);
    const category = resolve(command.category, `${where}.category`);
    const palette = category ? `${category}: ${title}` : title;
    lines.push(
      `| ${cell(title)} | ${code(palette)} | ${code(command.command)} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`generate-reference: cannot read ${path} — ${error.message}`);
    process.exit(2);
  }
}

/** The generated documents, as `{ path, content }`. Exported shape for tests. */
export function build(pkg, nls) {
  const resolve = makeResolver(nls);
  return [
    { file: "settings.md", content: generateSettings(pkg, resolve) },
    { file: "commands.md", content: generateCommands(pkg, resolve) },
  ];
}

function main() {
  const check = process.argv.includes("--check");
  const pkg = readJson(join(ROOT, "package.json"));
  const nls = readJson(join(ROOT, "package.nls.json"));

  let documents;
  try {
    documents = build(pkg, nls);
  } catch (error) {
    console.error(`generate-reference: ${error.message}`);
    process.exit(2);
  }

  if (!check) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const { file, content } of documents) {
      writeFileSync(join(OUT_DIR, file), content, "utf8");
    }
    console.log(
      `generate-reference: wrote ${documents.length} file(s) to docs/reference/.`,
    );
    return;
  }

  const stale = [];
  for (const { file, content } of documents) {
    let existing;
    try {
      existing = readFileSync(join(OUT_DIR, file), "utf8");
    } catch {
      stale.push(`  docs/reference/${file} — missing`);
      continue;
    }
    if (existing !== content) {
      stale.push(`  docs/reference/${file} — differs from package.json`);
    }
  }

  if (stale.length > 0) {
    console.error(
      "generate-reference: the committed reference does not match package.json.\n\n" +
        stale.join("\n") +
        "\n\nRun `npm run docs:reference` and commit the result.",
    );
    process.exit(1);
  }

  console.log(
    `generate-reference: docs/reference/ is up to date (${documents.length} file(s)).`,
  );
}

// Guarded so the test tier can import `build` without the script running.
if (process.argv[1] && process.argv[1].endsWith("generate-reference.mjs")) {
  main();
}
