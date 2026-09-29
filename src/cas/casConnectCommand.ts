// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `pythonOnViya.insertCasConnectionSnippet` command — 8b's own entry
 * point — and, since 12n, `pythonOnViya.refreshCasToken`, which writes the
 * same token file without inserting anything.
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
 * anything. Since 12n the token file has a stable name, the
 * `pythonOnViya.cas.tokenFileref` setting, and a second run rewrites it; that
 * rewrite is the command's whole point, so there is no confirmation to ask
 * for. A name the user's own SAS code holds is never written to
 * (`casToken.ts`'s `isOwnTokenFileref`); the command reports it instead.
 */

import * as vscode from "vscode";

import { AUTH_PROVIDER_ID } from "../auth/authProvider";
import { accountForEndpoint } from "../auth/identity";
import { abortOn, type CancellationLike } from "../compute/cancellation";
import { type ComputeClient } from "../compute/client";
import { localiseComputeProblem } from "../compute/messages";
import {
  DEFAULT_CAS_TOKEN_FILEREF,
  normaliseCasTokenFilerefName,
  writeCasToken,
} from "../compute/casToken";
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
  /** (11c, B2) Drops this window's cached connection for a profile this
   * command has just discovered is actually gone (`ComputeProblem`
   * `session-gone`, from `writeCasToken` below) and re-syncs
   * `pythonOnViya.connected` — `ComputeCommandHandles.forgetProfile`, the
   * same handle `RunCommandSessions.forgetProfile` (`src/run/commands.ts`)
   * takes for the identical reason. Without this, a session that dies
   * between two runs left the user with no way back into the palette's
   * **Connect** short of **Disconnect** first — this command reported
   * `localiseComputeProblem`'s "no longer available" sentence but never told
   * `src/compute` its own belief was stale. */
  forgetProfile(profileId: string): void;
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

/** A function shaped like `vscode.window.withProgress`, narrowed to a
 * cancellable notification and the one token type this command's network
 * calls need. Defaults to the real thing; a test cannot drive a real
 * progress notification's Cancel button, so it swaps in one that hands back
 * a token the test controls directly — the same port
 * `ComputeSessionManager`'s own `withProgress` dep uses. */
export type CasConnectCommandWithProgress = <T>(
  title: string,
  run: (token: CancellationLike) => Promise<T>,
) => Promise<T>;

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
  /** Refresh CAS Token's success message. Defaults to
   * `vscode.window.showInformationMessage`. */
  inform?: ((message: string) => void) | undefined;
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
  /** Defaults to a cancellable `vscode.window.withProgress` notification. */
  withProgress?: CasConnectCommandWithProgress | undefined;
  /** The raw `pythonOnViya.cas.tokenFileref` value, unnarrowed: `.get` only
   * substitutes the default when the setting is `undefined`, so a
   * non-string value written directly into `settings.json` (the schema
   * `pattern` only marks it in the settings *editor*) would otherwise reach
   * {@link normaliseCasTokenFilerefName} and throw on `.trim()`. Defaults to
   * reading the setting on every run, so a change applies without a reload. */
  tokenFilerefSetting?: (() => unknown) | undefined;
}

/** The dependencies both commands share, with each default filled in. */
interface ResolvedDeps {
  readonly report: (message: string) => void;
  readonly inform: (message: string) => void;
  readonly listAccounts: () => Thenable<readonly Account[]>;
  readonly getSession: (
    account: Account | undefined,
  ) => Thenable<vscode.AuthenticationSession | undefined>;
  readonly tokenFilerefSetting: () => unknown;
  readonly withProgress: CasConnectCommandWithProgress;
}

function resolveDeps(deps: CasConnectCommandDeps): ResolvedDeps {
  return {
    report:
      deps.report ??
      ((message: string) => void vscode.window.showErrorMessage(message)),
    inform:
      deps.inform ??
      ((message: string) => void vscode.window.showInformationMessage(message)),
    listAccounts:
      deps.listAccounts ??
      (() => vscode.authentication.getAccounts(AUTH_PROVIDER_ID)),
    getSession: deps.getSession ?? defaultGetSession,
    tokenFilerefSetting:
      deps.tokenFilerefSetting ??
      (() =>
        vscode.workspace
          .getConfiguration("pythonOnViya")
          .get<unknown>("cas.tokenFileref", DEFAULT_CAS_TOKEN_FILEREF)),
    withProgress:
      deps.withProgress ??
      (async (title, run) =>
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: true,
          },
          async (_progress, token) => await run(token),
        )),
  };
}

/** The active profile, as `ProfileStore.active` returns it when there is one. */
type ActiveProfile = NonNullable<
  ReturnType<CasConnectCommandProfiles["active"]>
>;

/** The connected profile and its Compute connection, or `undefined` after
 * reporting that there is none. */
function connectedProfile(
  sessions: CasConnectCommandSessions,
  profiles: CasConnectCommandProfiles,
  report: (message: string) => void,
):
  | {
      readonly active: ActiveProfile;
      readonly connection: CasConnectCommandConnection;
    }
  | undefined {
  const active = profiles.active();
  const connection =
    active === undefined ? undefined : sessions.current(active.profile.id);
  if (active === undefined || connection === undefined) {
    report(
      vscode.l10n.t("Connect to SAS Viya first, then run this command again."),
    );
    return undefined;
  }
  return { active, connection };
}

/** The token fileref name from the setting, or `undefined` after reporting
 * that the setting's value is not one `writeCasToken` will use. A value that
 * is not a string at all is reported the same way, shown as JSON. */
function tokenFilerefName(
  setting: () => unknown,
  report: (message: string) => void,
): string | undefined {
  const raw = setting();
  const name =
    typeof raw === "string" ? normaliseCasTokenFilerefName(raw) : undefined;
  if (name === undefined) {
    report(
      vscode.l10n.t(
        'The setting "pythonOnViya.cas.tokenFileref" is "{0}", which is not a name this command can use. Use 1 to 8 letters, digits or underscores, not starting with a digit, and not PYVSTART or PY followed by six digits.',
        typeof raw === "string" ? raw : JSON.stringify(raw),
      ),
    );
  }
  return name;
}

/** What {@link deliverToken} ended with: the token is in `filerefName`, or
 * there is a `message` to report (`undefined` when the user cancelled). */
type Delivery =
  | { readonly ok: true; readonly filerefName: string }
  | { readonly ok: false; readonly message: string | undefined };

/**
 * Reads the profile's current access token and writes it into the token
 * fileref — the part both commands share. Every failure becomes a message;
 * a failure caused by the user's own Cancel click becomes none, told apart by
 * asking the token, as `cancellation.ts`'s "ask the token first" rule says.
 */
async function deliverToken(
  resolved: ResolvedDeps,
  sessions: CasConnectCommandSessions,
  active: ActiveProfile,
  connection: CasConnectCommandConnection,
  filerefName: string,
  token: CancellationLike,
  signal: AbortSignal,
): Promise<Delivery> {
  const account = accountForEndpoint(
    active.profile.endpoint,
    await resolved.listAccounts(),
  );
  const authSession = await resolved.getSession(account);
  if (authSession === undefined) {
    return {
      ok: false,
      message: vscode.l10n.t(
        "The SAS Viya sign-in for this profile has ended.",
      ),
    };
  }

  const written = await writeCasToken(
    connection.client,
    connection.session,
    filerefName,
    authSession.accessToken,
    { signal },
  );
  if (!written.ok) {
    // (11c, B2) The session this command was using is actually gone — this
    // window's own cached belief that `active.profile` still holds one is
    // wrong. Mirrors `run/commands.ts`'s own `forgetIfGone`: re-sync
    // `pythonOnViya.connected` so **Connect** reappears in the palette
    // immediately, alongside the message below, rather than leaving
    // **Disconnect** as the only way back.
    if (written.problem.code === "session-gone") {
      sessions.forgetProfile(active.profile.id);
    }
    return {
      ok: false,
      message: token.isCancellationRequested
        ? undefined
        : localiseComputeProblem(written.problem),
    };
  }

  if (written.value.kind === "held-elsewhere") {
    return {
      ok: false,
      message: vscode.l10n.t(
        'This session already has a fileref named {0} that this extension did not create, so the token was not written to it. Set "pythonOnViya.cas.tokenFileref" to another name, or release it in your SAS code with "filename {0} clear;".',
        written.value.filerefName,
      ),
    };
  }
  return { ok: true, filerefName: written.value.filerefName };
}

/**
 * Builds the insert command's behaviour as a callable function — no
 * `vscode.commands.registerCommand` call inside it. See this module's own
 * doc comment for why.
 */
export function createInsertCasConnectionSnippet(
  sessions: CasConnectCommandSessions,
  cas: CasConnectCommandCas,
  profiles: CasConnectCommandProfiles,
  deps: CasConnectCommandDeps = {},
): () => Promise<void> {
  const resolved = resolveDeps(deps);
  const { report, withProgress } = resolved;
  const activeTextEditor =
    deps.activeTextEditor ?? (() => vscode.window.activeTextEditor);
  const pick =
    deps.showQuickPick ??
    (async <T extends vscode.QuickPickItem>(
      items: readonly T[],
      options: vscode.QuickPickOptions,
    ) => await vscode.window.showQuickPick([...items], options));

  return async function insertCasConnectionSnippet(): Promise<void> {
    const connected = connectedProfile(sessions, profiles, report);
    if (connected === undefined) return;
    const { active, connection } = connected;

    const editor = activeTextEditor();
    if (editor?.document.languageId !== "python") {
      report(
        vscode.l10n.t("Open a Python file first, then run this command again."),
      );
      return;
    }

    const filerefName = tokenFilerefName(resolved.tokenFilerefSetting, report);
    if (filerefName === undefined) return;

    const adapter = cas.adapterFor(active.profile.endpoint);
    if (adapter === undefined) {
      report(
        vscode.l10n.t(
          "Could not reach CAS for this profile. Sign in and try again.",
        ),
      );
      return;
    }

    // Everything past this point is network-bound (`getServers`,
    // `getConnection`, `listAccounts`+`getSession`, then `writeCasToken`'s
    // own three calls, or five or more when it rewrites a held fileref), so
    // it runs behind a cancellable progress notification with a single
    // `AbortSignal` threaded through every CAS/Compute call — the same shape
    // `ComputeSessionManager`'s own connect flow and `contentCommands.ts`'s
    // `run()` helper use. Each call already has a baked-in default timeout at
    // the transport layer (`CasClient`/`ComputeClient`'s own
    // `DEFAULT_TIMEOUT_MS`), so this is about user feedback and an explicit
    // cancel path, not an unbounded hang.
    const message = await withProgress(
      vscode.l10n.t("Connecting to CAS…"),
      async (token): Promise<string | undefined> => {
        const bridge = abortOn(token);
        try {
          const servers = await adapter.getServers(bridge.signal);
          if (!servers.ok) {
            // A request aborted by the user's own Cancel click comes back as
            // an ordinary `CasResult` failure — `CasClient`/`ComputeClient`
            // catch the abort and return it as `cas-unreachable`/
            // `compute-unreachable` — so cancellation is told apart from a
            // real failure by asking the token, not by inspecting the
            // problem, mirroring `cancellation.ts`'s own "ask the token
            // first" rule.
            return token.isCancellationRequested
              ? undefined
              : localiseCasProblem(servers.problem);
          }
          const [firstServer] = servers.value;
          if (firstServer === undefined) {
            return vscode.l10n.t(
              "This deployment reports no CAS server to connect to.",
            );
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
            if (picked === undefined) return undefined; // The user cancelled the picker.
            server = picked.server;
          }

          const connectionInfo = await adapter.getConnection(
            server,
            bridge.signal,
          );
          if (!connectionInfo.ok) {
            return token.isCancellationRequested
              ? undefined
              : localiseCasProblem(connectionInfo.problem);
          }

          const delivered = await deliverToken(
            resolved,
            sessions,
            active,
            connection,
            filerefName,
            token,
            bridge.signal,
          );
          if (!delivered.ok) return delivered.message;

          const snippet = buildCasConnectSnippet({
            host: connectionInfo.value.host,
            port: connectionInfo.value.port,
            filerefName: delivered.filerefName,
          });
          // Plain text, not `new vscode.SnippetString(snippet)`: `host` is
          // untrusted wire data (Finding 8.10), and `$`/`}` are
          // snippet-grammar metacharacters that `insertSnippet` would
          // reinterpret rather than insert literally — see
          // `connectSnippet.ts`'s own doc comment.
          await editor.edit((editBuilder) => {
            for (const selection of editor.selections) {
              editBuilder.replace(selection, snippet);
            }
          });
          return undefined;
        } finally {
          bridge.dispose();
        }
      },
    );
    if (message !== undefined) report(message);
  };
}

/**
 * Builds `pythonOnViya.refreshCasToken` (12n): write a fresh token into the
 * token fileref and insert nothing. For code that already opens the file by
 * its stable name — a committed module, or the profile's Python startup
 * snippet — so a new session, or an expired token, needs no editor at all.
 * It reads no CAS server or connection info: only the Compute session and
 * the sign-in are involved.
 */
export function createRefreshCasToken(
  sessions: CasConnectCommandSessions,
  profiles: CasConnectCommandProfiles,
  deps: CasConnectCommandDeps = {},
): () => Promise<void> {
  const resolved = resolveDeps(deps);
  const { report, inform, withProgress } = resolved;

  return async function refreshCasToken(): Promise<void> {
    const connected = connectedProfile(sessions, profiles, report);
    if (connected === undefined) return;
    const { active, connection } = connected;

    const filerefName = tokenFilerefName(resolved.tokenFilerefSetting, report);
    if (filerefName === undefined) return;

    const delivered = await withProgress(
      vscode.l10n.t("Refreshing the CAS token…"),
      async (token): Promise<Delivery> => {
        const bridge = abortOn(token);
        try {
          return await deliverToken(
            resolved,
            sessions,
            active,
            connection,
            filerefName,
            token,
            bridge.signal,
          );
        } finally {
          bridge.dispose();
        }
      },
    );
    if (delivered.ok) {
      inform(
        vscode.l10n.t(
          'The CAS token in {0} is refreshed. Python in this session reads it with open("{0}").',
          delivered.filerefName,
        ),
      );
    } else if (delivered.message !== undefined) {
      report(delivered.message);
    }
  };
}

/** The silent, account-hinted `getSession` these commands use in production
 * — identical in shape to `casExplorer.ts`'s own `defaultGetSession`, kept
 * as a separate copy rather than an import: the two modules have no other
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
 * Registers both commands against the real `vscode.commands` registry — the
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
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pythonOnViya.insertCasConnectionSnippet",
      createInsertCasConnectionSnippet(sessions, cas, profiles, deps),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.refreshCasToken",
      createRefreshCasToken(sessions, profiles, deps),
    ),
  );
}
