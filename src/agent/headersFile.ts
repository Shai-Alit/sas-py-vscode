// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The file the `headersHelper` prints: this server start's secret, as the
 * one header Claude Code should send. ADR-0042.
 *
 * **Why a file, and not `SecretStorage`.** Phase 12's 12c design put the
 * secret in `SecretStorage` and had the helper serve it. Nothing outside VS
 * Code can read `SecretStorage` — the helper is a separate process Claude
 * Code starts — so the secret has to reach it some other way. It is held in
 * memory and written here, in the workspace's own extension storage
 * (`ExtensionContext.storageUri`), which sits under the user's profile. On
 * POSIX the file is created `0600`; on Windows it inherits that directory's
 * ACL — the same access as the rest of the user's VS Code data, which in the
 * default location admits only the user, SYSTEM and administrators.
 *
 * **Why the port is in the name.** A registration's URL and helper path are
 * stored together. If the port moves, the old registration's helper names a
 * file that no longer exists, so its helper fails and Claude Code never sends
 * the new secret to whatever holds the old port. The user registers again,
 * which the extension tells them to do.
 *
 * **Why every start clears the directory.** A crash leaves the last file
 * behind. Its secret is dead — the next start makes a new one — but clearing
 * stale files keeps one live file per workspace, the one a registration can
 * name. A refresh that leaves the server off clears it too, so a crash's file
 * does not outlive it.
 *
 * Node-only, and on `eslint.config.mjs`'s built-in allow-list (ADR-0003's
 * 2026-09-28 amendment): `vscode.workspace.fs` cannot set a file mode, and
 * the removal has to be synchronous to run from `dispose()`.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HEADERS_FILE = /^mcp-headers-\d+\.json$/;

export function headersFileName(port: number): string {
  return `mcp-headers-${String(port)}.json`;
}

/** Writes the headers file for `port`, replacing any left from an earlier
 * start, and returns its path. */
export function writeHeadersFile(
  directory: string,
  port: number,
  secret: string,
): string {
  mkdirSync(directory, { recursive: true });
  removeHeadersFiles(directory);
  const file = join(directory, headersFileName(port));
  // `wx`: created fresh, so `mode` applies — it is ignored when a write
  // replaces an existing file.
  writeFileSync(file, JSON.stringify({ Authorization: `Bearer ${secret}` }), {
    mode: 0o600,
    flag: "wx",
  });
  return file;
}

/** Removes every headers file in `directory`. A missing directory has none. */
export function removeHeadersFiles(directory: string): void {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }
  for (const name of names) {
    if (HEADERS_FILE.test(name)) rmSync(join(directory, name), { force: true });
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
