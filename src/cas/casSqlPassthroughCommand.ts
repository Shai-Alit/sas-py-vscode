// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `pythonOnViya.insertCasSqlPassthroughSnippet` command — 11b's own
 * entry point, alongside the documentation `docs/cas-python-connection.md`
 * gained for the same slice.
 *
 * Deliberately far smaller than `casConnectCommand.ts` (8b): that command
 * needs a live Compute session to write a fresh token into, so it makes up
 * to five network round trips behind a cancellable progress notification.
 * This one needs none — the snippet it inserts is a fixed template
 * (`sqlPassthroughSnippet.ts`) with two user-filled tabstops, assuming the
 * user already has a `conn` from 8b's own command in the same file. It makes
 * the same three checks `casConnectCommand.ts` makes first, in the same order
 * and with the same wording: is there a connected session, is there an active
 * editor, and is it a Python file. The connection check is a warning, not
 * `enablement` in `package.json` (11c, manual test 11.12): a disabled command
 * is dropped from the palette entirely, which reads as a bug once a session
 * goes stale, whereas a message tells the user what to do. This command's own
 * body never touches the connection — the check only mirrors 8b's, since a
 * `conn` has to have come from a connected session.
 *
 * Same "handlers factory, thin registration shell" split as
 * `casConnectCommand.ts`'s own `createInsertCasConnectionSnippet`/
 * `registerCasConnectCommand`, for the same reason: a test builds the
 * handler directly with its own fakes rather than going through
 * `vscode.commands.registerCommand`.
 */

import * as vscode from "vscode";

import { type ProfileStore } from "../profile/store";
import { buildCasSqlPassthroughSnippet } from "./sqlPassthroughSnippet";

/** What this command reads from the profile store. */
export type CasSqlPassthroughProfiles = Pick<ProfileStore, "active">;

/** What this command reads from `ComputeSessionManager` — narrowed so a test
 * need not stand up a whole manager. */
export interface CasSqlPassthroughSessions {
  current(profileId: string): unknown;
}

/**
 * The ports this module would otherwise reach for on the `vscode` namespace
 * directly — same reasoning as `CasConnectCommandDeps`.
 */
export interface CasSqlPassthroughCommandDeps {
  /** Defaults to `vscode.window.activeTextEditor`. */
  activeTextEditor?: (() => vscode.TextEditor | undefined) | undefined;
  /** Defaults to `vscode.window.showErrorMessage`. */
  report?: ((message: string) => void) | undefined;
}

/**
 * Builds the command's behaviour as a callable function — no
 * `vscode.commands.registerCommand` call inside it. See this module's own
 * doc comment for why.
 */
export function createInsertCasSqlPassthroughSnippet(
  sessions: CasSqlPassthroughSessions,
  profiles: CasSqlPassthroughProfiles,
  deps: CasSqlPassthroughCommandDeps = {},
): () => Promise<void> {
  const activeTextEditor =
    deps.activeTextEditor ?? (() => vscode.window.activeTextEditor);
  const report =
    deps.report ??
    ((message: string) => void vscode.window.showErrorMessage(message));

  return async function insertCasSqlPassthroughSnippet(): Promise<void> {
    const active = profiles.active();
    if (
      active === undefined ||
      sessions.current(active.profile.id) === undefined
    ) {
      report(
        vscode.l10n.t(
          "Connect to SAS Viya first, then run this command again.",
        ),
      );
      return;
    }

    const editor = activeTextEditor();
    if (editor?.document.languageId !== "python") {
      report(
        vscode.l10n.t("Open a Python file first, then run this command again."),
      );
      return;
    }

    await editor.insertSnippet(
      new vscode.SnippetString(buildCasSqlPassthroughSnippet()),
    );
  };
}

/**
 * Registers the command against the real `vscode.commands` registry — the
 * thin shell `extension.ts` calls at activation. The disposable is pushed on
 * `context.subscriptions`.
 */
export function registerCasSqlPassthroughCommand(
  context: vscode.ExtensionContext,
  sessions: CasSqlPassthroughSessions,
  profiles: CasSqlPassthroughProfiles,
  deps: CasSqlPassthroughCommandDeps = {},
): void {
  const insertCasSqlPassthroughSnippet = createInsertCasSqlPassthroughSnippet(
    sessions,
    profiles,
    deps,
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pythonOnViya.insertCasSqlPassthroughSnippet",
      insertCasSqlPassthroughSnippet,
    ),
  );
}
