// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns a profile's `sasOptions` and `autoExec` into what the Compute service's
 * session request wants: `environment.options` and `environment.autoExecLines`.
 *
 * **This module must never import `vscode`** — see `model.ts` for why. Reading
 * an autoExec *file* needs the editor's file system, so the read is injected.
 *
 * Structure follows: client/src/components/profile.ts and
 * client/src/connection/rest/index.ts in sassoftware/vscode-sas-extension
 * (Apache-2.0). No code was copied. Two behaviours deliberately differ: only the
 * *first* `=` of an option is turned into a space (upstream rewrites every one,
 * which corrupts `SASAUTOS=("a=b")`-shaped values), and a file that cannot be
 * read is reported back to the caller instead of being swallowed.
 *
 * Wire behaviour is Finding 11.7 in `docs/phases/phase-11.md`.
 */

import type { AutoExecEntry } from "./model";

/**
 * Formats one SAS option the way the Compute service reads it.
 *
 * **Finding 11.7:** `environment.options` entries are `NAME VALUE`, with a space.
 * The `NAME=VALUE` form a SAS user writes in a program is accepted without error
 * and then silently not applied (`YEARCUTOFF=1950` left the option at its
 * default 1940), so a profile written the natural way would do nothing and say
 * nothing. A leading `-` (the command-line form) and a bare `NONUMBER`-style
 * switch are both accepted as-is.
 *
 * Only an `=` that comes before any whitespace is the separator; an `=` further
 * in belongs to the value and is left alone.
 */
export function formatSasOption(raw: string): string {
  const option = raw.trim();
  const separator = option.search(/[=\s]/);
  if (separator === -1 || option[separator] !== "=") return option;
  return `${option.slice(0, separator)} ${option.slice(separator + 1).trimStart()}`;
}

/**
 * The options for a new session: the extension's own first, then the profile's.
 *
 * Profile options come last so that a profile can override one of ours — when
 * an option name appears twice in `environment.options`, the later one wins
 * (Finding 11.9).
 */
export function buildSessionOptions(
  base: readonly string[],
  fromProfile: readonly string[] | undefined,
): string[] {
  return [...base, ...(fromProfile ?? []).map(formatSasOption)].filter(
    (option) => option !== "",
  );
}

/** A file the profile named that could not be read, and why. */
export interface AutoExecFileProblem {
  readonly filePath: string;
  readonly reason: string;
}

export interface AutoExecLines {
  readonly lines: string[];
  /** Files that were skipped. The lines from every other entry are still present. */
  readonly problems: AutoExecFileProblem[];
}

/**
 * Flattens a profile's `autoExec` entries into the lines to run at startup, in
 * the order the profile lists them.
 *
 * A file that cannot be read is skipped and reported rather than failing the
 * connect: the session is still useful without it, and the caller says so. The
 * alternative — silently connecting without the setup the user asked for — is
 * what `problems` exists to prevent.
 */
export async function resolveAutoExecLines(
  entries: readonly AutoExecEntry[] | undefined,
  readTextFile: (filePath: string) => Promise<string>,
): Promise<AutoExecLines> {
  const lines: string[] = [];
  const problems: AutoExecFileProblem[] = [];

  for (const entry of entries ?? []) {
    if (entry.type === "line") {
      lines.push(entry.line);
      continue;
    }
    try {
      const text = await readTextFile(entry.filePath);
      // A file ending in a newline would otherwise send a trailing "" (and an
      // empty file `[""]`), which `buildSessionOptions` already filters for
      // options but nothing probed for autoExecLines. Trimmed by popping, not
      // by a trailing-newline regex, which CodeQL flags as backtracking-prone.
      const fileLines = text.split(/\r\n|\n|\r/);
      while (fileLines.length > 0 && fileLines[fileLines.length - 1] === "") {
        fileLines.pop();
      }
      lines.push(...fileLines);
    } catch (error) {
      problems.push({
        filePath: entry.filePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { lines, problems };
}
