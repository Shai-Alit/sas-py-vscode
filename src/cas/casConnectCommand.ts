// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `pythonOnViya.insertCasConnectionSnippet` command — 8b's own entry
 * point.
 *
 * Unlike `src/cas/casExplorer.ts`'s browsing tree, which is deliberately
 * independent of any compute session (Finding 8.2, ADR-0033), this command
 * needs one: a token has to land inside a live Compute session's own run
 * directory (`src/compute/casToken.ts`) before a Python cell can read it, so
 * there is nowhere to write it without an active `ComputeConnection`. That
 * asymmetry is deliberate, not an inconsistency to fix — see
 * `docs/phases/phase-8.md`'s 8b Runbook entry.
 *
 * The orchestration lives in {@link createInsertCasConnectionSnippet} as a
 * plain function, not inside the `registerCommand` callback, mirroring
 * `src/run/commands.ts`'s `createRunCommandHandlers` split: a test builds it
 * with its own fakes and calls it directly, and `registerCasConnectCommand`
 * is the thin shell that wires the same function to the real registry.
 *
 * Every failure is reported with a non-modal `showErrorMessage` — the same
 * convention `src/run/commands.ts`'s `report` follows. Nothing here deletes
 * or overwrites anything, so there is no confirmation to ask for.
 */

import * as vscode from "vscode";

import { AUTH_PROVIDER_ID } from "../auth/authProvider";
import { accountForEndpoint } from "../auth/identity";
import { type ComputeClient } from "../compute/client";
import { localiseComputeProblem } from "../compute/messages";
import { writeCasToken } from "../compute/casToken";
import { type ComputeSession } from "../compute/session";
import { type ProfileStore } from "../profile/store";
import { type CasResult } from "./client";
import { buildCasConnectSnippet } from "./connectSnippet";
import { localiseCasProblem } from "./messages";
import { type CasConnectionInfo, type CasServerItem } from "./types";

/** What this command reads from the profile store. */
export type CasConnectCommandProfiles = Pick<ProfileStore, "active">;

/** The two `ComputeConnection` fields this command actually reads — narrowed
 * so a test can fake a connection without the dialect-resolution machinery
 * `ComputeConnection`'s other fields carry. `ComputeSessionManager.current`'s
 * real return type is a strict superset, so it satisfies this structurally. */
export interface CasConnectCommandConnection {
  readonly client: ComputeClient;
  readonly session: ComputeSession;
}

/** What this command reads from `ComputeSessionManager` — narrowed so a test
 * need not stand up a whole manager. */
export interface CasConnectCommandSessions {
  current(profileId: string): CasConnectCommandConnection | undefined;
}

/** The two `CasAdapter` methods this command needs — narrowed the same way
 * `CasSessionDeps`/`ComputeCommandProfiles` narrow their own dependencies,
 * so a test can fake them directly rather than standing up a real
 * `CasAdapter` over a fake `CasClient`. */
export interface CasConnectCommandAdapter {
  getServers(
    signal?: AbortSignal,
  ): Promise<CasResult<readonly CasServerItem[]>>;
  getConnection(
    server: CasServerItem,
    signal?: AbortSignal,
  ): Promise<CasResult<CasConnectionInfo>>;
}

/** What this command reads from `CasSession`. */
export interface CasConnectCommandCas {
  adapterFor(
    endpoint: string | undefined,
  ): CasConnectCommandAdapter | undefined;
}

type Account = vscode.AuthenticationSessionAccountInformation;

/** A `CasServerItem` wrapped for `showQuickPick`, so the picked item carries
 * the server straight through rather than needing a second lookup by label. */
interface ServerQuickPickItem extends vscode.QuickPickItem {
  readonly server: CasServerItem;
}

/**
 * The ports this module would otherwise reach for on the `vscode` namespace
 * directly — same reasoning as `RunCommandDeps`: a test cannot open a real
 * editor, drive a real quick pick, or hold a real silent auth session, so
 * each is injectable and defaults to the real thing.
 */
export interface CasConnectCommandDeps {
  /** Defaults to `vscode.window.activeTextEditor`. */
  activeTextEditor?: (() => vscode.TextEditor | undefined) | undefined;
  /** Defaults to `vscode.window.showQuickPick`. */
  showQuickPick?:
    | (<T extends vscode.QuickPickItem>(
        items: readonly T[],
        options: vscode.QuickPickOptions,
      ) => Thenable<T | undefined>)
    | undefined;
  /** Defaults to `vscode.window.showErrorMessage`. */
  report?: ((message: string) => void) | undefined;
  /** Defaults to `vscode.authentication.getAccounts` for this provider. */
  listAccounts?: (() => Thenable<readonly Account[]>) | undefined;
  /** Defaults to a **silent** `vscode.authentication.getSession` for this
   * provider — mirrors `casSession.ts`'s own `tokenFor` and
   * `casExplorer.ts`'s `defaultGetSession`: this command must never pop a
   * sign-in prompt of its own, since 8a's browsing tree and 8b's snippet
   * command share one profile's already-established sign-in. */
  getSession?:
    | ((
        account: Account | undefined,
      ) => Thenable<vscode.AuthenticationSession | undefined>)
    | undefined;
}

/**
 * Builds the command's behaviour as a callable function — no
 * `vscode.commands.registerCommand` call inside it. See this module's own
 * doc comment for why.
 */
export function createInsertCasConnectionSnippet(
  sessions: CasConnectCommandSessions,
  cas: CasConnectCommandCas,
  profiles: CasConnectCommandProfiles,
  deps: CasConnectCommandDeps = {},
): () => Promise<void> {
  const activeTextEditor =
    deps.activeTextEditor ?? (() => vscode.window.activeTextEditor);
  const report =
    deps.report ??
    ((message: string) => void vscode.window.showErrorMessage(message));
  const listAccounts =
    deps.listAccounts ??
    (() => vscode.authentication.getAccounts(AUTH_PROVIDER_ID));
  const getSession = deps.getSession ?? defaultGetSession;
  const pick =
    deps.showQuickPick ??
    (async <T extends vscode.QuickPickItem>(
      items: readonly T[],
      options: vscode.QuickPickOptions,
    ) => await vscode.window.showQuickPick([...items], options));

  return async function insertCasConnectionSnippet(): Promise<void> {
    const active = profiles.active();
    const connection =
      active === undefined ? undefined : sessions.current(active.profile.id);
    if (active === undefined || connection === undefined) {
      report(
        vscode.l10n.t(
          "Connect to SAS Viya first, then run this command again.",
        ),
      );
      return;
    }

    const editor = activeTextEditor();
    if (editor === undefined) {
      report(
        vscode.l10n.t("Open a Python file first, then run this command again."),
      );
      return;
    }

    const adapter = cas.adapterFor(active.profile.endpoint);
    if (adapter === undefined) {
      report(
        vscode.l10n.t(
          "Could not reach CAS for this profile. Sign in and try again.",
        ),
      );
      return;
    }

    const servers = await adapter.getServers();
    if (!servers.ok) {
      report(localiseCasProblem(servers.problem));
      return;
    }
    const [firstServer] = servers.value;
    if (firstServer === undefined) {
      report(
        vscode.l10n.t("This deployment reports no CAS server to connect to."),
      );
      return;
    }

    let server: CasServerItem;
    if (servers.value.length === 1) {
      server = firstServer;
    } else {
      const picked = await pick(
        servers.value.map((candidate): ServerQuickPickItem => ({
          label: candidate.name,
          server: candidate,
        })),
        { title: vscode.l10n.t("Select a CAS server") },
      );
      if (picked === undefined) return; // The user cancelled the picker.
      server = picked.server;
    }

    const connectionInfo = await adapter.getConnection(server);
    if (!connectionInfo.ok) {
      report(localiseCasProblem(connectionInfo.problem));
      return;
    }

    const account = accountForEndpoint(
      active.profile.endpoint,
      await listAccounts(),
    );
    const authSession = await getSession(account);
    if (authSession === undefined) {
      report(vscode.l10n.t("The SAS Viya sign-in for this profile has ended."));
      return;
    }

    const written = await writeCasToken(
      connection.client,
      connection.session,
      authSession.accessToken,
    );
    if (!written.ok) {
      report(localiseComputeProblem(written.problem));
      return;
    }

    const snippet = buildCasConnectSnippet({
      host: connectionInfo.value.host,
      port: connectionInfo.value.port,
      filerefName: written.value.filerefName,
    });
    // Plain text, not `new vscode.SnippetString(snippet)`: `host` is
    // untrusted wire data (Finding 8.10), and `$`/`}` are snippet-grammar
    // metacharacters that `insertSnippet` would reinterpret rather than
    // insert literally — see `connectSnippet.ts`'s own doc comment.
    await editor.edit((editBuilder) => {
      for (const selection of editor.selections) {
        editBuilder.replace(selection, snippet);
      }
    });
  };
}

/** The silent, account-hinted `getSession` this command uses in production —
 * identical in shape to `casExplorer.ts`'s own `defaultGetSession`, kept as
 * a separate copy rather than an import: the two modules have no other
 * shared dependency, and this one is three lines. */
async function defaultGetSession(
  account: Account | undefined,
): Promise<vscode.AuthenticationSession | undefined> {
  return await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
    silent: true,
    ...(account === undefined ? {} : { account }),
  });
}

/**
 * Registers the command against the real `vscode.commands` registry — the
 * thin shell `extension.ts` calls at activation. Every disposable is pushed
 * on `context.subscriptions`.
 */
export function registerCasConnectCommand(
  context: vscode.ExtensionContext,
  sessions: CasConnectCommandSessions,
  cas: CasConnectCommandCas,
  profiles: CasConnectCommandProfiles,
  deps: CasConnectCommandDeps = {},
): void {
  const insertCasConnectionSnippet = createInsertCasConnectionSnippet(
    sessions,
    cas,
    profiles,
    deps,
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pythonOnViya.insertCasConnectionSnippet",
      insertCasConnectionSnippet,
    ),
  );
}
