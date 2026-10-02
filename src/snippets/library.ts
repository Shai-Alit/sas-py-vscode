// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The snippet library (13d, F11): common Viya patterns for Python files and
 * notebook cells.
 *
 * The snippets live in one file, `snippets/python.json`, in VS Code's
 * snippet format. `package.json` contributes it for `python`, so each
 * snippet is offered as its prefix is typed; every prefix starts with
 * `viya-`, so none crowds a Python extension's own. The **Insert Viya
 * Snippet** command (`insertSnippetCommand.ts`) reads the same file and
 * lists only these, so the two cannot disagree.
 *
 * What each body asserts about the `SAS` bridge and `swat` was probed
 * (Findings 13.42–13.46 in `docs/phases/phase-13.md`).
 *
 * **This module must never import `vscode`.**
 */

/** One snippet, as the picker shows and inserts it. */
export interface SnippetEntry {
  /** The snippet's name: its key in the file. */
  readonly name: string;
  readonly prefix: string;
  /** The body's lines joined with `\n`, in VS Code snippet syntax. */
  readonly body: string;
  readonly description: string;
}

/**
 * The entries in a snippet file's text, in file order, or a reason it is not
 * one. Only the shape this project writes is accepted: a string `prefix`, a
 * `body` of string lines, and a string `description`.
 */
export function parseSnippetLibrary(
  text: string,
): { ok: true; entries: SnippetEntry[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: `it is not JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "it is not a JSON object" };
  }

  const entries: SnippetEntry[] = [];
  // Widened from `any`, so each field below is checked rather than trusted.
  const fields: [string, unknown][] = Object.entries(parsed);
  for (const [name, value] of fields) {
    if (typeof value !== "object" || value === null) {
      return { ok: false, reason: `"${name}" is not an object` };
    }
    const prefix = "prefix" in value ? value.prefix : undefined;
    const body = "body" in value ? value.body : undefined;
    const description = "description" in value ? value.description : undefined;
    if (typeof prefix !== "string") {
      return { ok: false, reason: `"${name}" has no string prefix` };
    }
    if (
      !Array.isArray(body) ||
      body.length === 0 ||
      !body.every((line): line is string => typeof line === "string")
    ) {
      return { ok: false, reason: `"${name}" has no body of string lines` };
    }
    if (typeof description !== "string") {
      return { ok: false, reason: `"${name}" has no string description` };
    }
    entries.push({ name, prefix, body: body.join("\n"), description });
  }
  return { ok: true, entries };
}
