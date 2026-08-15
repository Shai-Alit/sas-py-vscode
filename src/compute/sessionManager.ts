// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The one place a compute session is connected, reconnected and let go of.
 *
 * Everything 2a-i built is pure and knows nothing about VS Code; this is the
 * shell that gives it a profile, a token, a memento and a progress bar. Later
 * slices ask this class for a session rather than creating one, which is the
 * whole point: upstream keeps its connection in a process-global mutable
 * singleton, so a second profile in the same window overwrites the first, and a
 * feature we already ship — two profiles, live at once — is foreclosed by it.
 * Here the live sessions are a map keyed by profile id.
 *
 * ## Connect is three outcomes, not two
 *
 * Reattached, created, or nothing. "Nothing" is a first-class result and is
 * returned as `undefined` rather than thrown, because most of the ways connecting
 * does not happen are ordinary: the user cancelled, the folder is untrusted, no
 * profile is selected. Each of those has already been said to the user by the
 * time this returns.
 *
 * ## The token is borrowed, never stored
 *
 * It comes from `vscode.authentication.getSession`, and it comes from there on
 * *every request* — `ComputeClientConfig.token` is a function for exactly this
 * reason. A compute session outlives the access token that created it (900
 * seconds of idle life against a token measured in minutes), so a client holding
 * a string would start failing with 401s that a refresh has already fixed.
 * Nothing here reads `SecretStorage`; slice 1c owns credentials and this asks it.
 *
 * ## What is deliberately not here yet
 *
 * The busy check and the job poll. Both are on 2a-ii's punch list and both are
 * about *submitting* — finding 27's "refuse rather than queue" needs something to
 * refuse, and finding 28's `wait` + `If-None-Match` pairing needs a job to poll.
 * They land with the run path in 3a, against the same probe findings. What this
 * slice owes them is the seam they hang off, which is {@link ComputeConnection}.
 */

import * as vscode from "vscode";

import { AUTH_PROVIDER_ID } from "../auth/authProvider";
import type { ViyaProfile } from "../profile/model";
import type { ProfileStore } from "../profile/store";
import { bindingMatches, type SessionBinding } from "./binding";
import type { SessionBindingStore } from "./bindingStore";
import { abortOn, type CancellationLike } from "./cancellation";
import {
  createComputeClient,
  type ComputeClient,
  type ComputeClientConfig,
  type ComputeFailure,
} from "./client";
import { listContexts, resolveContext } from "./contexts";
import { localiseComputeProblem } from "./messages";
import { describeComputeProblem } from "./problems";
import {
  attachSession,
  createSession,
  deleteSession,
  waitWhilePending,
  type ComputeSession,
} from "./session";

/**
 * The three things this needs from the profile store.
 *
 * Narrowed for the same reason `ProfileStorageContext` is: a test can satisfy
 * three members, and it cannot satisfy a `ProfileStore` without a settings file
 * and a configuration listener. It also says, in the type, that connecting reads
 * the active profile and writes back exactly one field.
 */
export type ComputeProfileSource = Pick<
  ProfileStore,
  "active" | "activeName" | "upsert"
>;

/**
 * A live compute session, and everything needed to keep talking to it.
 *
 * The client travels with the session rather than being rebuilt per call,
 * because it carries the deployment root and the token function — both of which
 * belong to the profile this session was opened for, and neither of which a later
 * slice should have to reassemble correctly.
 */
export interface ComputeConnection {
  readonly profileId: string;
  readonly profileName: string;
  readonly context: string;
  readonly client: ComputeClient;
  /** As last read. A state is a fact about a moment; re-read before acting on it. */
  readonly session: ComputeSession;
}

/**
 * The ports this class would otherwise reach for on the `vscode` namespace.
 *
 * Every one of them is here for the same reason `AuthProviderDeps` exists: the
 * integration host cannot be made untrusted, cannot be signed in to a real
 * deployment, and cannot be asked to answer a modal. A gate whose closed branch
 * never executes is a comment, so the gates are injectable and the tests close
 * them.
 */
export interface ComputeSessionDeps {
  /** Defaults to {@link vscode.workspace.isTrusted}. */
  isTrusted?: (() => boolean) | undefined;
  /** Defaults to `vscode.authentication.getSession` for this provider. */
  authSession?:
    | ((
        createIfNone: boolean,
      ) => Thenable<vscode.AuthenticationSession | undefined>)
    | undefined;
  /** Defaults to {@link createComputeClient}. */
  createClient?: ((config: ComputeClientConfig) => ComputeClient) | undefined;
  /** Defaults to `vscode.window.withProgress`. */
  withProgress?:
    | (<T>(
        title: string,
        run: (token: CancellationLike) => Promise<T>,
      ) => Thenable<T>)
    | undefined;
  /** Defaults to `vscode.window.showQuickPick`. */
  pick?:
    | ((
        items: readonly string[],
        title: string,
      ) => Thenable<string | undefined>)
    | undefined;
  /** Defaults to `vscode.window.showInformationMessage`. */
  inform?: ((message: string) => void) | undefined;
  /** Defaults to `vscode.window.showErrorMessage`. */
  report?: ((message: string) => void) | undefined;
}

export class ComputeSessionManager implements vscode.Disposable {
  /** Keyed on profile id. Two profiles may hold sessions at the same time. */
  private readonly live = new Map<string, ComputeConnection>();

  /**
   * The connect currently running, so a second invocation joins it.
   *
   * Without this, double-clicking the status bar starts two sessions and the
   * second overwrites the first in `live` — leaving a SAS process running that
   * nothing holds a reference to, until the 900-second timeout reaps it.
   */
  private connecting: Promise<ComputeConnection | undefined> | undefined;

  constructor(
    private readonly profiles: ComputeProfileSource,
    private readonly bindings: SessionBindingStore,
    private readonly log: vscode.LogOutputChannel,
    private readonly deps: ComputeSessionDeps = {},
  ) {}

  /** The session this window holds for a profile, without opening one. */
  current(profileId: string): ComputeConnection | undefined {
    return this.live.get(profileId);
  }

  /**
   * Connects the active profile, reattaching to this workspace's session when
   * there is one to reattach to.
   *
   * `undefined` means it did not happen and the user has already been told why.
   */
  async connect(): Promise<ComputeConnection | undefined> {
    this.connecting ??= this.runConnect().finally(() => {
      this.connecting = undefined;
    });
    return await this.connecting;
  }

  /**
   * Ends the session this window holds, and forgets it.
   *
   * The manual reaper ADR-0012 names. `deactivate` deliberately does **not** do
   * this: persisting an id so a reload can reconnect and destroying the session
   * on exit are contradictory, and a reload is the case the persistence exists
   * for. Fifteen idle minutes is the automatic reaper; this is the one a user
   * asks for by name.
   *
   * It waits for a connect in flight before deciding there is nothing to end.
   * Without that, a disconnect arriving mid-connect finds an empty `live`, says
   * "there is no session", clears a binding that is about to be rewritten, and
   * the connect then finishes and leaves the session running — the user having
   * been told the opposite. The command `enablement` conditions make this hard
   * to reach from the palette, but a keybinding, another extension and a second
   * window all call the command directly, and `connect` already guards the
   * mirror image of this race.
   */
  async disconnect(): Promise<void> {
    // Swallowed rather than propagated: a connect that threw has already told
    // the user, and rethrowing it out of *disconnect* would report the wrong
    // command's failure.
    await this.connecting?.catch(() => undefined);

    const active = this.profiles.active();
    if (active === undefined) return;

    const held = this.live.get(active.profile.id);
    this.live.delete(active.profile.id);
    await this.bindings.clear(active.profile.id);

    if (held === undefined) {
      // The binding is cleared either way. A window that never attached can
      // still hold a pointer to a session another window started, and "forget
      // it" is what the user asked for.
      this.inform(vscode.l10n.t("There is no SAS Viya session to disconnect."));
      return;
    }

    const result = await deleteSession(held.client, held.session);
    if (!result.ok) {
      // A `404` already counted as success inside `deleteSession`, so reaching
      // here means something else — and the session is gone from this window
      // regardless, which is why this is reported rather than reversed.
      this.log.warn(
        vscode.l10n.t(
          "Ending the SAS Viya session did not complete: {0}",
          describeComputeProblem(result.problem),
        ),
      );
      return;
    }
    this.log.info(vscode.l10n.t("Ended the SAS Viya session."));
  }

  dispose(): void {
    // Nothing is torn down on the server. See `disconnect`.
    //
    // A connect in flight is deliberately **not** joined here, which is the one
    // place in this file that does not apply the discipline `connect` and
    // `disconnect` apply to each other. Raised in review and accepted rather
    // than fixed: this runs while the window is closing, so a connect that
    // completes afterwards repopulates a `Map` nothing will read again and
    // rewrites a `workspaceState` key with the id of a session that really was
    // started. Awaiting it would be worse — it delays the window closing on a
    // round trip whose only purpose is to update state that is about to be
    // discarded, and `dispose` is synchronous, so there is nowhere to await it
    // that VS Code would honour. The session itself is not orphaned by this:
    // it is reachable through the binding and reclaimed on the next connect.
    this.live.clear();
  }

  private async runConnect(): Promise<ComputeConnection | undefined> {
    if (!this.trusted()) {
      this.fail(
        vscode.l10n.t(
          "Connecting to SAS Viya requires a trusted folder. Run Workspaces: Manage Workspace Trust and trust this folder, then try again.",
        ),
      );
      return undefined;
    }

    const active = this.profiles.active();
    if (active === undefined) {
      this.inform(
        vscode.l10n.t(
          "Select a SAS Viya connection profile before connecting.",
        ),
      );
      return undefined;
    }

    const held = this.live.get(active.profile.id);
    if (held !== undefined) return held;

    // Asked for once, with `createIfNone`, so an unsigned-in user gets the
    // browser flow rather than an error telling them to run another command.
    const auth = await this.authSession(true);
    if (auth === undefined) return undefined;

    // The provider issues one session per profile and its id **is** the profile
    // id, so this compares like with like. It matters because `getSession` picks
    // the account, not us: with two profiles signed in, VS Code asks the user,
    // and answering with the other one would otherwise open a session on a
    // deployment they did not select. Refusing names the command that fixes it.
    if (auth.id !== active.profile.id) {
      this.fail(
        vscode.l10n.t(
          'The account chosen is not the one "{0}" uses. Run Python on Viya: Switch Connection Profile to change which deployment this folder uses.',
          active.name,
        ),
      );
      return undefined;
    }

    const client = this.clientFor(active.profile);

    const context = await this.contextFor(active.profile, client);
    if (context === undefined) return undefined;

    const connection = await this.withProgress(
      vscode.l10n.t("Connecting to SAS Viya…"),
      async (token) => {
        const bridge = abortOn(token);
        try {
          return await this.open(active, context, client, bridge.signal, token);
        } finally {
          bridge.dispose();
        }
      },
    );

    // Only once a session has actually started on it. Writing the pick before
    // the attempt — which is what this did until 2026-08-15 — pins the profile
    // to a context that does not work, and because a profile *with* a context
    // never reaches the picker, the user cannot choose again from inside the
    // editor. Observed against a live deployment: a context offering no
    // `createSession` link was picked, failed, and every later connect failed
    // the same way while the picker stayed out of reach.
    if (connection !== undefined && active.profile.context === undefined) {
      await this.rememberContext(active.profile, context);
    }
    return connection;
  }

  /**
   * Records the picked context on the profile, so it is asked once.
   *
   * Written through the profile store, so it lands wherever the user's own
   * profile setting lives rather than in a target they cannot see. The active
   * name is re-read rather than carried: this runs after a round trip to the
   * deployment, and a settings edit landing in between should write to the
   * profile that exists now or to nothing at all.
   */
  private async rememberContext(
    profile: ViyaProfile,
    context: string,
  ): Promise<void> {
    const name = this.profiles.activeName();
    if (name === undefined) return;
    await this.profiles.upsert(name, { ...profile, context });
  }

  /**
   * Reattach if we can, create if we cannot.
   *
   * The order is the decision ADR-0012 records: the stored id is used, not
   * checked. A `404` is the answer to "is it still there", it costs the same
   * round trip as any probe would, and finding 29 measured it as the *only*
   * shape a dead session produces.
   */
  private async open(
    active: { name: string; profile: ViyaProfile },
    context: string,
    client: ComputeClient,
    signal: AbortSignal,
    token: CancellationLike,
  ): Promise<ComputeConnection | undefined> {
    const { profile } = active;
    const stored = this.bindings.read(profile.id);

    if (stored !== undefined && bindingMatches(stored, context)) {
      const attached = await attachSession(client, stored.id, { signal });
      if (attached.ok) {
        this.log.info(
          vscode.l10n.t("Reconnected to the SAS Viya session for this folder."),
        );
        return this.hold(active, context, client, attached.value);
      }
      if (attached.problem.code !== "session-gone") {
        this.reportFailure(attached, token.isCancellationRequested);
        return undefined;
      }
      // Ordinary: fifteen idle minutes is lunch. Said at `info` because the
      // user asked to connect and is about to get a new session anyway.
      this.log.info(
        vscode.l10n.t(
          "The previous SAS Viya session has ended, so a new one will be started. Anything defined in it is gone.",
        ),
      );
      await this.bindings.clear(profile.id);
    } else if (stored !== undefined) {
      this.log.info(
        vscode.l10n.t(
          "The compute context for this profile has changed, so a new SAS Viya session will be started.",
        ),
      );
      await this.bindings.clear(profile.id);
    }

    const resolved = await resolveContext(client, context, { signal });
    if (!resolved.ok) {
      this.reportFailure(resolved, token.isCancellationRequested);
      return undefined;
    }

    const created = await createSession(client, resolved.value, { signal });
    if (!created.ok) {
      this.reportFailure(created, token.isCancellationRequested);
      return undefined;
    }

    const settled = await waitWhilePending(client, created.value, { signal });
    if (!settled.ok) {
      // The session exists and is not usable, so it is taken down rather than
      // left to occupy a launcher slot for fifteen minutes. Not awaited: the
      // user is waiting on the real failure and should not also wait on the
      // tidying. Not reported either, for the same reason.
      //
      // Caught, though. `deleteSession` resolves a `ComputeResult` for every
      // failure it anticipates, but `client.send` rethrows whatever
      // `resolveHref` throws that is not a `ForeignLinkError`, and a rejection
      // with no handler lands in the extension host as an unhandled rejection
      // rather than anywhere a reader would look. `debug` because an orphaned
      // session costs a launcher slot for fifteen minutes and nothing else.
      void deleteSession(client, created.value).catch((error: unknown) => {
        this.log.debug(
          `could not take down the unusable compute session: ${String(error)}`,
        );
      });
      this.reportFailure(settled, token.isCancellationRequested);
      return undefined;
    }

    const binding: SessionBinding = { id: settled.value.id, context };
    await this.bindings.write(profile.id, binding);
    this.log.info(
      vscode.l10n.t(
        'Started a SAS Viya session on compute context "{0}".',
        context,
      ),
    );
    return this.hold(active, context, client, settled.value);
  }

  private hold(
    active: { name: string; profile: ViyaProfile },
    context: string,
    client: ComputeClient,
    session: ComputeSession,
  ): ComputeConnection {
    const connection: ComputeConnection = {
      profileId: active.profile.id,
      profileName: active.name,
      context,
      client,
      session,
    };
    this.live.set(active.profile.id, connection);
    return connection;
  }

  /**
   * The compute context to use: the profile's, or one the user picks.
   *
   * A profile with no context is ordinary — the setting is optional and the add
   * prompt says so — and the alternative to asking is guessing a name that varies
   * by deployment. The choice is written back to the profile so it is asked once
   * and is afterwards visible in settings, where the user can change it, rather
   * than living in a second hidden store — but by {@link rememberContext},
   * after the connect succeeds, and not here.
   */
  private async contextFor(
    profile: ViyaProfile,
    client: ComputeClient,
  ): Promise<string | undefined> {
    if (profile.context !== undefined) return profile.context;

    // The cancellation flag comes back out with the result. This progress has
    // its own token, the failure is handled after `withProgress` returns, and a
    // token that only exists inside the callback cannot be asked the one
    // question every failure path here has to ask.
    const attempt = await this.withProgress(
      vscode.l10n.t("Reading compute contexts…"),
      async (token) => {
        const bridge = abortOn(token);
        try {
          return {
            listed: await listContexts(client, { signal: bridge.signal }),
            cancelled: token.isCancellationRequested,
          };
        } finally {
          bridge.dispose();
        }
      },
    );
    const { listed } = attempt;
    if (!listed.ok) {
      this.reportFailure(listed, attempt.cancelled);
      return undefined;
    }

    const names = listed.value.map(({ name }) => name);
    if (names.length === 0) {
      this.fail(
        vscode.l10n.t(
          "This deployment offers no compute contexts you can see. Ask your SAS administrator for one you may start a session on.",
        ),
      );
      return undefined;
    }

    // Returned, not recorded. `runConnect` writes it back only if a session
    // starts on it; see {@link rememberContext}.
    return await this.pick(
      names,
      vscode.l10n.t("Select a compute context for this connection profile"),
    );
  }

  /**
   * A client for a profile, whose token is fetched per request.
   *
   * `createIfNone: false` inside the token function on purpose: this runs behind
   * a request that is already in flight, and a browser window opening there
   * would be a sign-in prompt with no visible cause. Connecting has already asked
   * once, interactively, at a moment the user was expecting it.
   */
  private clientFor(profile: ViyaProfile): ComputeClient {
    const create = this.deps.createClient ?? createComputeClient;
    return create({
      root: profile.endpoint,
      token: async () => {
        const session = await this.authSession(false);
        if (session === undefined) {
          throw new Error(
            vscode.l10n.t("The SAS Viya sign-in for this profile has ended."),
          );
        }
        return session.accessToken;
      },
    });
  }

  /**
   * Shows a failure, unless the user is the one who stopped it.
   *
   * An aborted request comes back as `compute-unreachable`, whose message is
   * about not reaching the deployment — accurate for a dropped connection and
   * misleading for someone who pressed Cancel. See `./cancellation`.
   *
   * It returns nothing, and its callers say `return undefined` on the next line
   * rather than returning the call. That is `no-confusing-void-expression`'s
   * rule and it is a fair one here: `return this.reportFailure(…)` reads as
   * though the failure were the connect's result, when the result is that there
   * is no connection.
   *
   * `cancelled` is a boolean rather than the token it is read from, because a
   * token is not always in scope where a failure is handled: `contextFor` runs
   * its progress and handles the result on either side of the callback boundary,
   * and taking a token here is what let that path skip the check entirely. One
   * fact is easier to carry across a boundary than the object it came from.
   */
  private reportFailure(failure: ComputeFailure, cancelled: boolean): void {
    if (cancelled) {
      this.log.info(vscode.l10n.t("Connecting to SAS Viya was cancelled."));
      return;
    }
    this.log.error(describeComputeProblem(failure.problem));
    this.report(localiseComputeProblem(failure.problem));
  }

  private trusted(): boolean {
    return (this.deps.isTrusted ?? (() => vscode.workspace.isTrusted))();
  }

  /**
   * The two ways this asks for a token, and they are not the same call.
   *
   * `createIfNone` is the interactive one, made once when the user asked to
   * connect. `silent` is the per-request one: it answers only if this extension
   * already has access, and never puts UI in front of someone who is waiting for
   * a request to come back. Passing both to VS Code at once is rejected, which is
   * why this branches rather than assembling one options object.
   */
  private async authSession(
    createIfNone: boolean,
  ): Promise<vscode.AuthenticationSession | undefined> {
    const get = this.deps.authSession;
    if (get !== undefined) return await get(createIfNone);

    return await (createIfNone
      ? vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
          createIfNone: true,
        })
      : vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
          silent: true,
        }));
  }

  private async withProgress<T>(
    title: string,
    run: (token: CancellationLike) => Promise<T>,
  ): Promise<T> {
    const show = this.deps.withProgress;
    if (show !== undefined) return await show(title, run);

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      async (_progress, token) => await run(token),
    );
  }

  private async pick(
    items: readonly string[],
    title: string,
  ): Promise<string | undefined> {
    const show = this.deps.pick;
    if (show !== undefined) return await show(items, title);

    return await vscode.window.showQuickPick([...items], {
      title,
      ignoreFocusOut: true,
    });
  }

  private inform(message: string): void {
    const show = this.deps.inform;
    if (show !== undefined) {
      show(message);
      return;
    }
    void vscode.window.showInformationMessage(message);
  }

  private report(message: string): void {
    const show = this.deps.report;
    if (show !== undefined) {
      show(message);
      return;
    }
    void vscode.window.showErrorMessage(message);
  }

  /** Reports a refusal the user can act on, and records it. */
  private fail(message: string): void {
    this.log.warn(message);
    this.report(message);
  }
}
