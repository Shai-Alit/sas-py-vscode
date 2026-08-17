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
 * ## The generation is asked once, and only once it can be asked honestly
 *
 * A connection carries the dialect the deployment will be spoken to in, and
 * stage-1 probing runs in {@link ComputeSessionManager.hold} — after a session
 * exists, never before. That ordering is the control `src/dialects/probe.ts`
 * documents as its precondition rather than checking for itself. The answer is
 * cached per profile, so reconnecting does not re-ask.
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
import { isSignInCancelled } from "../auth/cancellation";
import { accountForEndpoint } from "../auth/identity";
import { getSessionOptions, type AuthRequest } from "../auth/sessionRequest";
import { probeCadence } from "../dialects/probe";
import {
  deploymentFromSignal,
  resolveDialect,
  type CadenceSignal,
  type DialectResolution,
} from "../dialects/resolve";
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
 *
 * `get` rather than `activeName`: the write-back happens after a round trip, and
 * by then "the active profile" is a different question from "the profile this
 * connect was for". See {@link ComputeSessionManager.rememberContext}.
 */
export type ComputeProfileSource = Pick<
  ProfileStore,
  "active" | "get" | "upsert"
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
  /**
   * Which generation this deployment is, how sure we are, and why.
   *
   * Never absent, because `resolveDialect` is total: a probe that answered
   * nothing still yields the Viya 4 dialect with `certain: false`, which is the
   * fail-soft behaviour §2.3 asks for. Callers that must not act on a guess read
   * `certain`; callers that just need to talk to the deployment reach straight
   * through to `.dialect` and ignore it.
   *
   * The resolution rather than the bare `Dialect`, and `generation` rather
   * than `dialect`, for the same reason. `certain` is the supported way to ask
   * "was this determined?", and the alternative — inspecting
   * `dialect.deployment.kind` — is version branching wearing a different hat.
   * The name puts it inside `no-restricted-syntax`'s net, so a later slice that
   * reaches for `connection.generation === …` is told where that belongs.
   */
  readonly generation: DialectResolution;
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
        request: AuthRequest,
      ) => Thenable<vscode.AuthenticationSession | undefined>)
    | undefined;
  /**
   * Defaults to `vscode.authentication.getAccounts` for this provider.
   *
   * Read once per connect, to work out which account the active profile's
   * deployment is already signed in to. Never called per request: the answer
   * travels with the connection instead.
   */
  accounts?:
    | (() => Thenable<
        readonly vscode.AuthenticationSessionAccountInformation[]
      >)
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
   * What stage-1 probing determined for a profile, so it is asked once.
   *
   * Keyed on profile id like {@link live}, but deliberately **outlives** the
   * connection: reconnecting after a fifteen-minute idle reap does not make the
   * deployment a different generation, and re-probing on every connect would be
   * two round trips to re-learn a fact that changes about once a quarter.
   *
   * The endpoint is stored alongside because the id is not enough. A profile is
   * a settings entry the user edits in place — repoint one at a different
   * deployment, keep its id, and a cache keyed on the id alone would answer for
   * the deployment it used to name. `rememberContext` guards the same edit for
   * the same reason.
   *
   * Only `certain` resolutions are recorded; see {@link generationFor}. Nothing
   * clears this deliberately: a deployment upgraded from one cadence to the next
   * while the window is open reports the old release until the window is
   * reloaded, which is the cost of not re-probing and is a fair one — the
   * release is used to pick behaviour, not to display a version to the user.
   */
  private readonly generations = new Map<
    string,
    { endpoint: string; resolution: DialectResolution }
  >();

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

    // Asked for once, interactively, so an unsigned-in user gets the browser
    // flow rather than an error telling them to run another command — and asked
    // *for a named account* whenever this deployment already has one, so a
    // window signed in to two Viyas resumes the right session instead of
    // offering the user a list only one entry of which can work.
    const account = await this.accountFor(active.profile);
    const auth = await this.authSession(
      account === undefined ? { kind: "new" } : { kind: "known", account },
    );
    if (auth === undefined) return undefined;

    // The provider issues one session per profile and its id **is** the profile
    // id, so this compares like with like.
    //
    // This used to be the ordinary outcome of having two profiles, because
    // nothing above named an account and VS Code chose one. It is now the
    // narrow case the account hint cannot reach: **two profiles pointing at the
    // same deployment**. They share an account id — it is keyed on endpoint and
    // user, and neither distinguishes them — so the hint is satisfied by either
    // profile's session and the host may return the other one. There is no
    // option on `getSession` that says "this profile"; the session id is ours
    // and the host does not take it as input. So the check stays, as the last
    // thing between a picked account and a compute session started under it.
    if (auth.id !== active.profile.id) {
      this.fail(
        vscode.l10n.t(
          'The account chosen is not the one "{0}" uses. Run Python on Viya: Switch Connection Profile to change which deployment this folder uses.',
          active.name,
        ),
      );
      return undefined;
    }

    // `auth.account`, not the hint: the hint may have been absent, and after an
    // interactive sign-in this is who was actually signed in as.
    const client = this.clientFor(active.profile, auth.account);

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
      await this.rememberContext(active.name, active.profile, context);
    }
    return connection;
  }

  /**
   * Records the picked context on the profile, so it is asked once.
   *
   * Written through the profile store, so it lands wherever the user's own
   * profile setting lives rather than in a target they cannot see.
   *
   * The name is the one captured when the connect started, and the profile under
   * it is re-read and checked before anything is written. Both halves matter, and
   * an earlier version of this got the pairing wrong in a way review caught: it
   * carried the profile it connected with but asked the store which name was
   * active *now*. Switch Connection Profile during a connect and those two
   * describe different profiles, so the write lands the old profile's endpoint
   * and id under the new profile's name — silently, and destroying the profile
   * the user just switched to.
   *
   * Re-reading is not only a safety check. Whatever else changed under that name
   * while the round trip was in flight is spread through, so an edit made during
   * the connect survives instead of being reverted to the copy this started with.
   * If the profile has since been renamed, removed, pointed at a different
   * deployment, or given a context by hand, nothing is written at all: a context
   * is only meaningful against the deployment it was listed from, and none of
   * those profiles is the one that was connected to.
   *
   * The lesson, third time of asking (see {@link contextFor} and the
   * cancellation check before it): a value that was true when the work started
   * is not a fact about the world when the work finishes.
   */
  private async rememberContext(
    name: string,
    profile: ViyaProfile,
    context: string,
  ): Promise<void> {
    const current = this.profiles.get(name);
    if (current === undefined) return;
    if (current.id !== profile.id) return;
    if (current.endpoint !== profile.endpoint) return;
    if (current.context !== undefined) return;
    await this.profiles.upsert(name, { ...current, context });
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
        return await this.hold(active, context, client, attached.value, signal);
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
    return await this.hold(active, context, client, settled.value, signal);
  }

  /**
   * Records a connection, and gives it the dialect it will be spoken to in.
   *
   * The probe hangs here rather than in `runConnect` because this is the one
   * point both of `open`'s success paths pass through — reattached and freshly
   * created alike — and because it is the point at which the precondition
   * `src/dialects/probe.ts` documents is satisfied: a session exists, so the
   * host is a reachable Viya that this token works against. Only then is a
   * Viya-shaped 404 a statement about the endpoint rather than about the
   * network (finding 42).
   */
  private async hold(
    active: { name: string; profile: ViyaProfile },
    context: string,
    client: ComputeClient,
    session: ComputeSession,
    signal: AbortSignal,
  ): Promise<ComputeConnection> {
    const connection: ComputeConnection = {
      profileId: active.profile.id,
      profileName: active.name,
      context,
      client,
      generation: await this.generationFor(active.profile, client, signal),
      session,
    };
    this.live.set(active.profile.id, connection);
    return connection;
  }

  /**
   * The deployment's generation: from {@link generations} if it is known, else
   * probed for and, if the answer was conclusive, remembered.
   *
   * ## Why an inconclusive answer is not cached
   *
   * `certain: false` is not a finding about the deployment, it is a report about
   * one attempt to ask — a cancelled connect, a proxy in the way, a service that
   * had not come up yet. Caching it would let a transient failure decide how
   * this window talks to the deployment until it is reloaded, which is the
   * silent-and-wrong outcome the whole `CadenceSignal` union exists to avoid.
   * The cost of not caching it is one extra pair of requests per connect on a
   * deployment that keeps refusing to answer, which is the right way round.
   *
   * ## Why this cannot fail a connect
   *
   * `probeCadence` never rejects — it is decoration on a connection that has
   * already succeeded, and it turns every outcome into a signal. Nothing here
   * adds a way for it to throw: `resolveDialect` is total over `Deployment`, and
   * logging cannot fail a `LogOutputChannel`.
   *
   * ## A cancelled probe is logged as an assumption like any other
   *
   * `reportFailure` refuses to blame a user who pressed Cancel, and that rule
   * deliberately does not reach here. It applies to a connect that *failed*; a
   * cancellation landing in the gap between a session settling and the probe
   * answering leaves a connection the user is about to use, and the honest thing
   * to say about it is that the version was not determined — which is what the
   * warning says. Nothing is cached, so the next connect asks again.
   */
  private async generationFor(
    profile: ViyaProfile,
    client: ComputeClient,
    signal: AbortSignal,
  ): Promise<DialectResolution> {
    const cached = this.generations.get(profile.id);
    if (cached?.endpoint === profile.endpoint) {
      return cached.resolution;
    }

    const probed = await probeCadence(client, { signal });
    const resolution = resolveDialect(deploymentFromSignal(probed));
    if (resolution.certain) {
      this.generations.set(profile.id, {
        endpoint: profile.endpoint,
        resolution,
      });
    }

    // Which generation, and why, in one line — `reason` carries both, including
    // whether the generation was determined or assumed. The level is the
    // certainty: everything the extension does after an assumed resolution is
    // done on an assumption, and a bug report that opens with a warning here is
    // a bug report that has already named its most likely cause.
    const line = vscode.l10n.t(
      "SAS Viya version: {0}.",
      describeVersion(probed, resolution),
    );
    if (resolution.certain) this.log.info(line);
    else this.log.warn(line);

    return resolution;
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
   * Silent on purpose: this runs behind a request that is already in flight, and
   * a browser window opening there would be a sign-in prompt with no visible
   * cause. Connecting has already asked once, interactively, at a moment the
   * user was expecting it.
   *
   * `account` is that connect's answer, carried in rather than looked up again.
   * It has to be named here as well or the silent refresh is the unguarded call
   * the interactive one no longer is: a window signed in to two deployments
   * would renew from whichever account the host offered, and the wrong bearer
   * token would be sent to a live Compute session under a name nobody chose.
   * That failure reports nothing — the request either 401s or, worse, succeeds
   * against a deployment the user did not pick — which makes it the more
   * important of the two paths to get right, not the lesser one.
   */
  private clientFor(
    profile: ViyaProfile,
    account?: vscode.AuthenticationSessionAccountInformation,
  ): ComputeClient {
    const create = this.deps.createClient ?? createComputeClient;
    return create({
      root: profile.endpoint,
      token: async () => {
        const session = await this.authSession({
          kind: "silent",
          ...(account === undefined ? {} : { account }),
        });
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
   * A token, or `undefined` if the user decided not to sign in after all.
   *
   * Cancelling is the one rejection this turns back into a value. It arrives
   * here as a rejection because `getSession` has no other way to say it — but
   * connecting already has a word for "no session", and it is `undefined`, so
   * translating here means every frame above stays as it was.
   *
   * This is also the one place in the extension where the error being caught has
   * crossed an RPC hop: `vscode.authentication.getSession` reaches our own
   * provider through the editor, which rebuilds anything thrown as a plain
   * `Error`. See `src/auth/cancellation.ts` for why the check is on `name`.
   */
  private async authSession(
    request: AuthRequest,
  ): Promise<vscode.AuthenticationSession | undefined> {
    try {
      return await this.askForSession(request);
    } catch (error) {
      if (!isSignInCancelled(error)) {
        // Everything else is still thrown, and still lands on the user as
        // "Running the contributed command … failed". That is #130's to fix and
        // not this one's: a deployment that cannot be reached is a real failure
        // and deserves a real message, it just deserves a better one than that.
        throw error;
      }

      // The user closed the browser. `undefined` is what every other "no session
      // for you" answer looks like to `runConnect`, so connecting stops here and
      // says nothing — and the provider has already logged it, on this side of
      // the hop as well as the other, because both ends are this extension.
      return undefined;
    }
  }

  /**
   * The one call to `getSession` this extension makes. See {@link AuthRequest}
   * for the three shapes a request comes in, and {@link getSessionOptions} for
   * what each one turns into — including why the `new` arm has to clear the
   * host's remembered account.
   *
   * That mapping is next door and pure on purpose. It used to be a `switch`
   * here, which meant the injected port below sat *above* the only code that
   * knew what we actually asked for, and no test could reach it.
   */
  private async askForSession(
    request: AuthRequest,
  ): Promise<vscode.AuthenticationSession | undefined> {
    const get = this.deps.authSession;
    if (get !== undefined) return await get(request);

    return await vscode.authentication.getSession(
      AUTH_PROVIDER_ID,
      [],
      getSessionOptions(request),
    );
  }

  /**
   * Which account this deployment is already signed in to, if exactly one is.
   *
   * One call per connect, and its failure mode is deliberately quiet: no account
   * is an ordinary state — nobody has signed in yet — and so is an ambiguous
   * one. Both mean the same thing to the caller, which is that the sign-in has
   * to be asked for rather than resumed.
   */
  private async accountFor(
    profile: ViyaProfile,
  ): Promise<vscode.AuthenticationSessionAccountInformation | undefined> {
    const list =
      this.deps.accounts ??
      (() => vscode.authentication.getAccounts(AUTH_PROVIDER_ID));
    return accountForEndpoint(profile.endpoint, await list());
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

/**
 * One sentence naming the generation, why it was chosen, and what else the probe
 * saw.
 *
 * `DialectResolution.reason` is the spine of it and says everything a *correct*
 * resolution needs to. The parenthetical is the part `./resolve` deliberately
 * throws away, and it is exactly the part a bug report needs:
 *
 * - the `unreadable` **detail** — "`/deploymentData` answered HTTP 404, but not
 *   with a link document" — which is the difference between a proxy in the way
 *   and a deployment that really has no such endpoint. Without it the channel
 *   would say only that the version could not be determined, which is the one
 *   thing the reader already knows.
 * - the `cadence` **display name** — "Long-Term Support 2026.03" against a
 *   release of "2026.03" (finding 40). Appended rather than substituted,
 *   because a support track is not a version and nothing may come to read it as
 *   one.
 *
 * Not localised, and not by omission. Both halves are strings the deployment or
 * the resolver produced, in the same register as `describeComputeProblem`'s
 * output, and a translated frame around an untranslated diagnostic reads worse
 * than an untranslated pair.
 */
function describeVersion(
  probed: CadenceSignal,
  resolution: DialectResolution,
): string {
  const aside = asideFor(probed);
  return aside === undefined
    ? resolution.reason
    : `${resolution.reason} (${aside})`;
}

/** Whatever the signal knew that the resolution's reason does not. */
function asideFor(probed: CadenceSignal): string | undefined {
  switch (probed.kind) {
    case "cadence":
      return probed.display;
    case "unreadable":
      return probed.detail;
    case "absent":
      // Nothing to add: "the deployment is Viya 3.5" is the whole finding, and
      // the evidence for it is an absence, which does not describe.
      return undefined;
  }
}
