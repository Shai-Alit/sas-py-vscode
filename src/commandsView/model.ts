// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What the Commands view shows (13c, F6): common commands in groups, so a
 * user need not remember their palette names.
 *
 * The view is state-aware, as Sean decided on 2026-10-02: it offers Connect
 * or Disconnect, never both, Sign In only while no account is signed in, and
 * Cancel only while a run is going. The state is four context keys, which
 * `commandsView.ts` reads from `src/contextKeys.ts` and passes here. Three
 * of them are what the palette's `enablement` clauses read. The fourth,
 * `pythonOnViya.authorized`, is not in Sign In's `enablement`: it means
 * "any account is signed in", not "the active profile is", so the palette
 * still offers Sign In when another profile's account is the signed-in one,
 * and the view does not. The sidebar's welcome views test `!authorized` the
 * same way, and Connect on such a profile still leads to sign-in. Everything
 * else is always shown: a command that cannot act says why when clicked, as
 * it does from the palette.
 *
 * Free of `vscode`, so the unit tier covers it; labels and icons are in
 * `commandsView.ts`.
 */

/** The context keys the view follows. */
export interface CommandsViewState {
  /** `pythonOnViya.hasProfiles`. */
  readonly hasProfiles: boolean;
  /** `pythonOnViya.authorized`. */
  readonly authorized: boolean;
  /** `pythonOnViya.connected`. */
  readonly connected: boolean;
  /** `pythonOnViya.running`. */
  readonly running: boolean;
}

export type CommandsGroupId = "connection" | "run" | "snippets";

/** An entry's id is its command's id without the `pythonOnViya.` prefix. */
export type CommandsEntryId =
  | "addProfile"
  | "signIn"
  | "connect"
  | "disconnect"
  | "switchProfile"
  | "runFile"
  | "openInteractiveWindow"
  | "cancelRun"
  | "resetPythonState"
  | "selectRunTarget"
  | "insertCasConnectionSnippet"
  | "insertCasSqlPassthroughSnippet"
  | "refreshCasToken"
  | "showOutputChannel";

export type CommandsNode =
  | {
      readonly kind: "group";
      readonly id: CommandsGroupId;
      readonly entries: readonly CommandsEntryId[];
    }
  | { readonly kind: "entry"; readonly id: CommandsEntryId };

/** The command an entry runs. */
export function commandFor(entry: CommandsEntryId): string {
  return `pythonOnViya.${entry}`;
}

/** The view's top level: three groups, then Show Log on its own. */
export function commandsViewRoots(
  state: CommandsViewState,
): readonly CommandsNode[] {
  return [
    { kind: "group", id: "connection", entries: connectionEntries(state) },
    { kind: "group", id: "run", entries: runEntries(state) },
    {
      kind: "group",
      id: "snippets",
      entries: ["insertCasConnectionSnippet", "insertCasSqlPassthroughSnippet"],
    },
    { kind: "entry", id: "showOutputChannel" },
  ];
}

function connectionEntries(state: CommandsViewState): CommandsEntryId[] {
  // With no profile, nothing else in the group can act.
  if (!state.hasProfiles) return ["addProfile"];
  const entries: CommandsEntryId[] = [];
  if (!state.authorized) entries.push("signIn");
  entries.push(state.connected ? "disconnect" : "connect");
  entries.push("switchProfile", "addProfile");
  return entries;
}

function runEntries(state: CommandsViewState): CommandsEntryId[] {
  // Run File works with no profile too: the run target may be local.
  const entries: CommandsEntryId[] = ["runFile", "openInteractiveWindow"];
  if (state.running) entries.push("cancelRun");
  // Refresh CAS Token writes nothing into the editor, so it is not a
  // snippet; it acts on the run's Python session (Sean, 2026-10-02).
  entries.push("resetPythonState", "selectRunTarget", "refreshCasToken");
  return entries;
}
