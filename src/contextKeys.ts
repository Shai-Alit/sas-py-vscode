// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The extension's own `when`-clause context keys, recorded as they are set so
 * code can read them back (13c).
 *
 * VS Code has no API to read a context key, and the Commands view
 * (`src/commandsView/`) needs four of them — whether a profile exists, the
 * sign-in, the connection and a run in flight — to show only the commands
 * that apply. Each is set in its own module (`profile/commands.ts`,
 * `auth/authProvider.ts`, `compute/commands.ts`, `run/commands.ts`), and
 * those modules set it through {@link setContextKey} instead of calling
 * `setContext` directly. The view then reads the very values the palette's
 * `enablement` clauses read, so the two cannot disagree; a second way of
 * working the state out would be a second way to get it wrong, which is what
 * `AUTHORIZED_CONTEXT_KEY`'s own comment warns against.
 *
 * Module state, like the SAS Content clipboard in `content/contentCommands.ts`:
 * there is one set of context keys per window, so there is one mirror.
 */

import * as vscode from "vscode";

const values = new Map<string, unknown>();
const changed = new vscode.EventEmitter<string>();

/** Fires with a key's name when {@link setContextKey} changes its value. */
export const onDidChangeContextKey: vscode.Event<string> = changed.event;

/** Sets a context key, as `setContext` does, and records the value. Fires
 * {@link onDidChangeContextKey} only when the value changed. */
export function setContextKey(key: string, value: unknown): Thenable<unknown> {
  const isNew = !values.has(key) || values.get(key) !== value;
  // Recorded before `setContext` resolves: `setContext` does not reject in
  // practice, and if it did the mirror would lead VS Code by one value until
  // the next set, which the view shrugs off.
  values.set(key, value);
  if (isNew) changed.fire(key);
  return vscode.commands.executeCommand("setContext", key, value);
}

/** The value {@link setContextKey} last set for `key`; `undefined` if never
 * set, as a `when` clause also reads it. */
export function contextKeyValue(key: string): unknown {
  return values.get(key);
}
