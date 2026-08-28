// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import * as vscode from "vscode";

import type {
  ComputeClient,
  ComputeRequest,
  ComputeResponse,
  ComputeResult,
} from "../../../src/compute/client";
import { SignInCancelledError } from "../../../src/auth/cancellation";
import { accountId } from "../../../src/auth/identity";
import type { AuthRequest } from "../../../src/auth/sessionRequest";
import { SessionBindingStore } from "../../../src/compute/bindingStore";
import {
  ComputeSessionManager,
  type ComputeProfileSource,
  type ComputeSessionDeps,
} from "../../../src/compute/sessionManager";
import type { ViyaProfile } from "../../../src/profile/model";
import {
  memoryMemento,
  recordingLog,
  testLogChannel,
} from "../../helpers/auth-host";

/**
 * The connect/reconnect orchestrator, in a host, against a scripted deployment.
 *
 * Everything below the manager is already covered by the unit tier — the client,
 * the codec, the session calls. What is only reachable here is the *ordering*:
 * which gate is checked before which, whether a stored id is used or probed, and
 * what happens to a binding when the session it names has gone. Those are
 * assertions about the requests that were and were not made, which is why almost
 * every test ends by counting them.
 *
 * The deps are injected rather than stubbed globally because the integration host
 * cannot be made untrusted, cannot be signed in to a real deployment, and cannot
 * answer a quick pick. A gate whose closed branch never executes is a comment.
 */

const PROFILE_ID = "session-manager-integration";
const PROFILE_NAME = "verde";
/** A second profile, for the tests about what a connect must not touch. */
const OTHER_NAME = "production";
const ENDPOINT = "https://viya.example.com";
const CONTEXT = "SAS Job Execution compute context";
const CONTEXT_ID = "00000000-0000-4000-8000-0000000000c1";
const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
/** Stage-1 capability probing: the entry point, and where it points. */
const DEPLOYMENT_DATA_PATH = "/deploymentData";
const CADENCE_PATH = "/deploymentData/cadenceVersion";
const RELEASE = "2026.03";

function profile(init?: Partial<ViyaProfile>): ViyaProfile {
  return {
    version: 1,
    id: init?.id ?? PROFILE_ID,
    endpoint: init?.endpoint ?? ENDPOINT,
    ...(init?.context === undefined ? {} : { context: init.context }),
  };
}

interface Profiles extends ComputeProfileSource {
  /** Every `upsert` the manager made, so the context write-back is assertable. */
  readonly written: { name: string; profile: ViyaProfile }[];
  /**
   * Rewrites the store from underneath a connect in flight.
   *
   * The manager re-reads by name before writing the picked context back, so the
   * only way to exercise that check is to change what that name resolves to
   * while a connect is running — which is what switching profile, renaming one
   * or editing `settings.json` mid-connect does.
   */
  replace(name: string, next: ViyaProfile | undefined): void;
}

function profileSource(current?: ViyaProfile): Profiles {
  const written: { name: string; profile: ViyaProfile }[] = [];
  const held = new Map<string, ViyaProfile>();
  if (current !== undefined) held.set(PROFILE_NAME, current);
  let activeName: string | undefined =
    current === undefined ? undefined : PROFILE_NAME;
  return {
    written,
    replace: (name, next) => {
      if (next === undefined) held.delete(name);
      else held.set(name, next);
      activeName = next === undefined ? undefined : name;
    },
    active: () => {
      if (activeName === undefined) return undefined;
      const profile = held.get(activeName);
      return profile === undefined ? undefined : { name: activeName, profile };
    },
    get: (name: string) => held.get(name),
    upsert: (name: string, next: ViyaProfile) => {
      written.push({ name, profile: next });
      held.set(name, next);
      return Promise.resolve();
    },
  };
}

function contextsBody(): unknown {
  return {
    count: 1,
    items: [
      {
        id: CONTEXT_ID,
        name: CONTEXT,
        links: [
          {
            method: "POST",
            rel: "createSession",
            href: `/compute/contexts/${CONTEXT_ID}/sessions`,
            type: "application/vnd.sas.compute.session.request",
            responseType: "application/vnd.sas.compute.session",
          },
        ],
      },
    ],
    links: [],
  };
}

/**
 * `/deploymentData`, trimmed to the part the probe navigates.
 *
 * Both `cadenceVersion` relations are kept, because finding 44 is the reason the
 * probe selects by media type rather than by `rel`, and a fixture with one of
 * them would let a `rel`-only lookup pass. `method` is `null` on every link in
 * the real document, so it is `null` here too.
 */
function deploymentDataBody(links?: unknown[]): unknown {
  return {
    version: 1,
    links: links ?? [
      {
        method: null,
        rel: "cadenceVersion",
        href: CADENCE_PATH,
        type: "application/vnd.sas.deployment.data.cadence.version",
      },
      {
        method: null,
        rel: "cadenceVersion",
        href: CADENCE_PATH,
        type: "application/vnd.sas.app.registry.cadence.version",
      },
    ],
  };
}

/** The cadence resource, as finding 40 measured it. */
function cadenceBody(): unknown {
  return {
    cadenceVersion: RELEASE,
    cadenceDisplayName: `Long-Term Support ${RELEASE}`,
  };
}

/** A session that has already settled, so nothing polls its state. */
function sessionBody(init?: { state?: string }): unknown {
  return {
    id: SESSION_ID,
    state: init?.state ?? "idle",
    attributes: { sessionInactiveTimeout: 900 },
    links: [
      { method: "GET", rel: "self", href: SESSION_PATH },
      { method: "GET", rel: "state", href: `${SESSION_PATH}/state` },
      { method: "DELETE", rel: "delete", href: SESSION_PATH },
    ],
  };
}

function ok(body: unknown, status = 200): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status,
      notModified: false,
      contentType: "application/vnd.sas.compute.session+json",
      text: JSON.stringify(body),
      body,
    },
  };
}

function gone(): ComputeResult<ComputeResponse> {
  return {
    ok: false,
    reason: "the compute service answered HTTP 404",
    problem: { code: "compute-rejected", error: { status: 404 } },
  };
}

/** A `DELETE` that succeeded, which is how a session is ended. */
function deleted(): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: { status: 204, notModified: false, text: "", body: undefined },
  };
}

interface Deployment {
  readonly requests: ComputeRequest[];
  readonly client: ComputeClient;
  /** Hrefs requested, in order — the shortest form of "what did it do". */
  readonly hrefs: string[];
}

/**
 * What a Viya 4 answers the version probe with, unless a test says otherwise.
 *
 * Merged under every script by {@link deployment} rather than written out per
 * test. Stage-1 probing runs after *every* successful connect, so without a
 * default every test about reattaching or about binding would have to script a
 * version check it says nothing about — and the ones that did not would be
 * asserting against a probe that had silently failed.
 */
function viya4Probe(): Partial<Record<string, ComputeResult<ComputeResponse>>> {
  return {
    deploymentData: ok(deploymentDataBody()),
    cadenceVersion: ok(cadenceBody()),
  };
}

/**
 * A deployment that answers by link relation rather than by call order.
 *
 * By relation on purpose: half these tests are about *which* calls happen, so a
 * script indexed by position would pass by lining up its replies with a wrong
 * sequence.
 */
function deployment(
  replies: Partial<Record<string, ComputeResult<ComputeResponse>>>,
): Deployment {
  const requests: ComputeRequest[] = [];
  const hrefs: string[] = [];
  const scripted = { ...viya4Probe(), ...replies };
  return {
    requests,
    hrefs,
    client: {
      send: (request) => {
        requests.push(request);
        hrefs.push(request.link.href);
        const reply = scripted[request.link.rel];
        assert.ok(
          reply !== undefined,
          `nothing was scripted for the "${request.link.rel}" link (${request.link.href})`,
        );
        return Promise.resolve(reply);
      },
    },
  };
}

/**
 * Runs `interfere` at the moment the session is created, then answers as scripted.
 *
 * The write-back the manager does *after* a connect is the thing under test in
 * several tests below, and all of them need the world to have moved on between
 * the connect starting and the write happening. This is the latest hook there
 * is that still precedes the write.
 */
function duringCreateSession(
  scripted: Deployment,
  interfere: () => void,
): ComputeClient {
  return {
    send: (request) => {
      if (request.link.rel === "createSession") interfere();
      return scripted.client.send(request);
    },
  };
}

/** An account keyed the way the provider keys one: deployment, then Viya user id. */
function account(
  endpoint = ENDPOINT,
  userId = "a7f3c1d9e2b4f6a80",
): vscode.AuthenticationSessionAccountInformation {
  return { id: accountId(endpoint, userId), label: "user@example.com" };
}

/** An authentication session whose id is the profile's, as the provider issues it. */
function authSession(id = PROFILE_ID): vscode.AuthenticationSession {
  return {
    id,
    accessToken: "access-token-placeholder",
    account: account(),
    scopes: [],
  };
}

interface Shown {
  readonly errors: string[];
  readonly infos: string[];
}

function harness(init: {
  profiles: Profiles;
  client: ComputeClient;
  deps?: Partial<ComputeSessionDeps>;
  state?: ReturnType<typeof memoryMemento>;
  /** Only where the log line *is* the behaviour — see {@link recordingLog}. */
  log?: vscode.LogOutputChannel;
}): {
  manager: ComputeSessionManager;
  bindings: SessionBindingStore;
  shown: Shown;
} {
  const log = init.log ?? testLogChannel("session manager");
  const state = init.state ?? memoryMemento();
  const bindings = new SessionBindingStore(state, log);
  const shown: Shown = { errors: [], infos: [] };

  const manager = new ComputeSessionManager(init.profiles, bindings, log, {
    isTrusted: () => true,
    // Stubbed even where a test says nothing about accounts: the fallback is a
    // real `vscode.authentication.getAccounts`, and a suite that reaches the
    // host's account list is one whose answers depend on what else has run.
    accounts: () => Promise.resolve([]),
    authSession: () => Promise.resolve(authSession()),
    createClient: () => init.client,
    // Run the work with a token nobody cancels, so no progress UI appears in a
    // test run and the cancellation arm stays under the test's control.
    withProgress: (_title, run) =>
      run(new vscode.CancellationTokenSource().token),
    pick: () => Promise.resolve(undefined),
    inform: (message) => shown.infos.push(message),
    report: (message) => shown.errors.push(message),
    ...init.deps,
  });

  return { manager, bindings, shown };
}

describe("compute session manager", () => {
  it("refuses to connect from an untrusted folder", async () => {
    const scripted = deployment({});
    const { manager, shown } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: { isTrusted: () => false },
    });

    const connection = await manager.connect();

    assert.equal(connection, undefined);
    // Refused before anything reaches the network, and before a sign-in prompt:
    // an untrusted folder must not be able to cause a token to be issued.
    assert.equal(scripted.requests.length, 0);
    assert.equal(shown.errors.length, 1);
    assert.match(shown.errors[0] ?? "", /trust/i);
  });

  it("says what to do when no profile is selected", async () => {
    const scripted = deployment({});
    const { manager, shown } = harness({
      profiles: profileSource(),
      client: scripted.client,
    });

    assert.equal(await manager.connect(), undefined);
    assert.equal(scripted.requests.length, 0);
    assert.equal(shown.infos.length, 1);
  });

  it("creates a session and remembers it for this workspace", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const profiles = profileSource(profile({ context: CONTEXT }));
    const { manager, bindings } = harness({
      profiles,
      client: scripted.client,
    });

    const connection = await manager.connect();

    assert.ok(connection, "connecting produced no session");
    assert.equal(connection.session.id, SESSION_ID);
    assert.equal(connection.context, CONTEXT);
    assert.equal(connection.profileName, PROFILE_NAME);
    assert.deepEqual(bindings.read(PROFILE_ID), {
      id: SESSION_ID,
      context: CONTEXT,
    });
  });

  it("fails the connect when no compute context is returned by that name", async () => {
    // Not a `ComputeFailure` any more (#135's open half, settled 2026-08-24 —
    // see `contexts.ts`): an empty `items` array is `resolveContext`'s answer
    // when it has nothing to report, and `open()` is the one place that turns
    // that plain absence into a real refusal to connect. Before this slice the
    // equivalent case was a `no-such-context` `ComputeFailure` and this was a
    // unit test on `describeComputeProblem`; there is no `ComputeProblem`
    // variant left to unit test, so the coverage moves here, onto the one
    // caller that renders a message for it.
    const scripted = deployment({
      contexts: ok({ count: 0, items: [], links: [] }),
    });
    const { manager, shown } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
    });

    const connection = await manager.connect();

    assert.equal(connection, undefined);
    assert.equal(shown.errors.length, 1);
    assert.ok(
      (shown.errors[0] ?? "").includes(CONTEXT),
      shown.errors[0] ?? "(nothing shown)",
    );
  });

  it("says nothing when a cancelled connect finds no such context", async () => {
    // The race `reportedCancellation` exists for: the empty collection can
    // arrive in the same instant the user cancels, and this checks that the
    // cancellation is what gets said — not the naming refusal that would
    // otherwise follow the same response.
    const source = new vscode.CancellationTokenSource();
    const scripted = deployment({
      contexts: ok({ count: 0, items: [], links: [] }),
    });
    const log = recordingLog("session manager context cancelled");
    const { manager, shown } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      log: log.channel,
      deps: {
        withProgress: (_title, run) => {
          source.cancel();
          return run(source.token);
        },
      },
    });

    assert.equal(await manager.connect(), undefined);

    assert.deepEqual(shown.errors, []);
    const line = log.lines.find(({ message }) => message.includes("cancelled"));
    assert.ok(line, "the cancellation was not logged");
    assert.equal(line.level, "info");
    assert.ok(
      !log.lines.some(({ message }) => message.includes(CONTEXT)),
      "the naming failure was logged despite the cancellation",
    );
  });

  it("hands back the session it already holds without asking again", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
    });

    const first = await manager.connect();
    const before = scripted.requests.length;
    const second = await manager.connect();

    assert.equal(second, first);
    assert.equal(scripted.requests.length, before);
  });

  it("forget() drops the cached connection, so the next connect starts fresh rather than reusing it", async () => {
    // Added 2026-08-28 (Phase 3's 3f slice). `forget()` exists for exactly
    // this: a caller has independently learned the session held here is
    // dead (an idle reap, a revoked token) and this manager's own belief
    // that `current()` still names a live one is simply wrong.
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
    });

    const first = await manager.connect();
    assert.ok(first, "the first connect produced no session");
    assert.equal(manager.current(PROFILE_ID), first);

    manager.forget(PROFILE_ID);

    assert.equal(
      manager.current(PROFILE_ID),
      undefined,
      "forget() left the stale connection cached",
    );

    const before = scripted.requests.filter(
      (r) => r.link.rel === "createSession",
    ).length;
    const second = await manager.connect();

    assert.ok(second, "the connect after forget() produced no session");
    assert.notEqual(
      second,
      first,
      "the connect after forget() reused the forgotten connection",
    );
    assert.equal(
      scripted.requests.filter((r) => r.link.rel === "createSession").length,
      before + 1,
      "forget() should make the next connect start a real session again",
    );
  });

  it("joins a connect that is already running rather than starting a second session", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replies: Partial<Record<string, ComputeResult<ComputeResponse>>> = {
      ...viya4Probe(),
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    };
    const requests: ComputeRequest[] = [];
    const client: ComputeClient = {
      send: async (request) => {
        requests.push(request);
        await held;
        const reply = replies[request.link.rel];
        assert.ok(reply !== undefined);
        return reply;
      },
    };
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client,
    });

    const both = Promise.all([manager.connect(), manager.connect()]);
    release();
    const [first, second] = await both;

    // Two SAS processes and only one reference kept is a leak that lasts until
    // the 900-second timeout reaps it, so double-clicking must not cause one.
    assert.equal(first, second);
    assert.equal(
      requests.filter((r) => r.link.rel === "createSession").length,
      1,
    );
  });

  it("reattaches to a stored session without resolving the context again", async () => {
    const state = memoryMemento();
    const scripted = deployment({ self: ok(sessionBody()) });
    const { manager, bindings } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      state,
    });
    await bindings.write(PROFILE_ID, { id: SESSION_ID, context: CONTEXT });

    const connection = await manager.connect();

    assert.ok(connection, "the stored session was not reattached to");
    assert.equal(connection.session.id, SESSION_ID);
    // Straight at the session, with no context resolution in front of it. The
    // stored id is used rather than checked: asking first would cost the same
    // round trip and answer nothing.
    //
    // The two that follow are stage-1 capability probing, and their position is
    // the point — the version is asked for only once a session proves the host
    // is a reachable Viya that this token works against (finding 42).
    assert.deepEqual(scripted.hrefs, [
      SESSION_PATH,
      DEPLOYMENT_DATA_PATH,
      CADENCE_PATH,
    ]);
  });

  it("starts a new session when the stored one has gone, and rebinds", async () => {
    const state = memoryMemento();
    const scripted = deployment({
      self: gone(),
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const { manager, bindings } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      state,
    });
    await bindings.write(PROFILE_ID, {
      id: "expired-session",
      context: CONTEXT,
    });

    const connection = await manager.connect();

    assert.ok(connection, "a dead binding did not produce a new session");
    // The stored id was tried first and the 404 was the answer — the only
    // answer a dead session gives, and the same one a never-existed id gives.
    assert.equal(scripted.hrefs[0], "/compute/sessions/expired-session");
    // Rebound to the session that now exists, not left pointing at the corpse.
    assert.deepEqual(bindings.read(PROFILE_ID), {
      id: SESSION_ID,
      context: CONTEXT,
    });
  });

  it("ignores a binding made against a different compute context", async () => {
    const state = memoryMemento();
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const { manager, bindings } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      state,
    });
    await bindings.write(PROFILE_ID, {
      id: SESSION_ID,
      context: "Data Mining compute context",
    });

    const connection = await manager.connect();

    assert.ok(connection, "changing the context produced no session");
    // Never asked for the old session: a user who changes the context and
    // reloads must not be reattached to an environment built from the old one.
    assert.ok(
      !scripted.hrefs.includes(SESSION_PATH),
      "the stale binding was used anyway",
    );
    assert.equal(bindings.read(PROFILE_ID)?.context, CONTEXT);
  });

  it("asks which context to use, and writes the answer back to the profile", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const profiles = profileSource(profile());
    const { manager } = harness({
      profiles,
      client: scripted.client,
      deps: { pick: () => Promise.resolve(CONTEXT) },
    });

    const connection = await manager.connect();

    assert.ok(connection, "picking a context produced no session");
    assert.equal(profiles.written.length, 1);
    // Read out once rather than indexed twice: `assert.equal` narrows what it
    // compares, so a second `written[0]?.` would be flagged as an optional
    // chain on something the first assertion already proved is there.
    const written = profiles.written[0];
    assert.ok(written, "nothing was written back to the profile");
    assert.equal(written.profile.context, CONTEXT);
    // Written through the profile, so the answer is visible in settings and
    // changeable there, rather than living in a second hidden store.
    assert.equal(written.name, PROFILE_NAME);
  });

  it("does not write the picked context back when the connect fails", async () => {
    // The failure that provoked this, observed against a live deployment on
    // 2026-08-15: a context the picker offered turned out to carry no
    // `createSession` link. The pick used to be written back before the attempt,
    // which pinned the profile to a context that cannot start a session — and
    // since a profile *with* a context never reaches the picker again, the only
    // way out was to hand-edit `settings.json`.
    const scripted = deployment({
      contexts: ok({
        count: 1,
        items: [{ id: CONTEXT_ID, name: CONTEXT, links: [] }],
        links: [],
      }),
    });
    const profiles = profileSource(profile());
    const { manager, shown } = harness({
      profiles,
      client: scripted.client,
      deps: { pick: () => Promise.resolve(CONTEXT) },
    });

    assert.equal(await manager.connect(), undefined);

    assert.deepEqual(
      profiles.written,
      [],
      "a failed connect pinned the profile to the context that failed",
    );
    assert.equal(shown.errors.length, 1);
  });

  it("writes the picked context to the profile it connected with, not the one now active", async () => {
    // Raised in review on 2026-08-15. The write-back used to carry the profile
    // it connected with but ask the store which name was active *now*, so
    // switching profile during a connect wrote the old profile's endpoint and id
    // under the new profile's name — destroying the profile just switched to,
    // silently, and leaving the connected one without its context.
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const profiles = profileSource(profile());
    const other: ViyaProfile = {
      version: 1,
      id: "a-different-profile",
      endpoint: "https://other.example.com",
    };
    const { manager } = harness({
      profiles,
      client: duringCreateSession(scripted, () => {
        profiles.replace(OTHER_NAME, other);
      }),
      deps: { pick: () => Promise.resolve(CONTEXT) },
    });

    assert.ok(await manager.connect(), "picking a context produced no session");

    const written = profiles.written[0];
    assert.ok(written, "nothing was written back to the profile");
    assert.equal(written.name, PROFILE_NAME);
    assert.equal(written.profile.id, PROFILE_ID);
    assert.deepEqual(
      profiles.get(OTHER_NAME),
      other,
      "the connect overwrote the profile the user switched to",
    );
  });

  it("keeps an edit made during the connect instead of reverting it", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const profiles = profileSource(profile());
    const { manager } = harness({
      profiles,
      client: duringCreateSession(scripted, () => {
        profiles.replace(PROFILE_NAME, {
          ...profile(),
          clientId: "edited-mid-connect",
        });
      }),
      deps: { pick: () => Promise.resolve(CONTEXT) },
    });

    assert.ok(await manager.connect(), "picking a context produced no session");

    // Re-read rather than carried, so the write is the current profile plus one
    // field rather than a copy taken before the round trip started.
    const written = profiles.written[0];
    assert.ok(written, "nothing was written back to the profile");
    assert.equal(written.profile.context, CONTEXT);
    assert.equal(written.profile.clientId, "edited-mid-connect");
  });

  it("does not record the context when the profile now names a different deployment", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const profiles = profileSource(profile());
    const { manager } = harness({
      profiles,
      client: duringCreateSession(scripted, () => {
        profiles.replace(PROFILE_NAME, {
          ...profile(),
          endpoint: "https://moved.example.com",
        });
      }),
      deps: { pick: () => Promise.resolve(CONTEXT) },
    });

    assert.ok(await manager.connect(), "picking a context produced no session");

    assert.deepEqual(
      profiles.written,
      [],
      "a context listed from one deployment was pinned to another",
    );
  });

  it("leaves a context set by hand during the connect alone", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const profiles = profileSource(profile());
    const { manager } = harness({
      profiles,
      client: duringCreateSession(scripted, () => {
        profiles.replace(PROFILE_NAME, profile({ context: "chosen by hand" }));
      }),
      deps: { pick: () => Promise.resolve(CONTEXT) },
    });

    assert.ok(await manager.connect(), "picking a context produced no session");

    assert.deepEqual(
      profiles.written,
      [],
      "the write-back overwrote a context the user set themselves",
    );
  });

  it("does nothing when the context picker is dismissed", async () => {
    const scripted = deployment({ contexts: ok(contextsBody()) });
    const { manager, shown } = harness({
      profiles: profileSource(profile()),
      client: scripted.client,
    });

    assert.equal(await manager.connect(), undefined);
    // Dismissing a picker is not a failure and gets no error notification.
    assert.deepEqual(shown.errors, []);
  });

  it("asks for the account this deployment is already signed in to", async () => {
    // Scripted through to a session even though only the auth request is
    // asserted: a profile naming a context still resolves that name to an id
    // against the deployment, so a connect that stops early stops for a reason
    // that has nothing to do with accounts.
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const asked: AuthRequest[] = [];
    const signedIn = account();
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: {
        accounts: () =>
          Promise.resolve([account("https://other.example.com"), signedIn]),
        authSession: (request) => {
          asked.push(request);
          return Promise.resolve(authSession());
        },
      },
    });

    assert.ok(await manager.connect(), "the connect produced no session");

    // The point of the whole exercise: with two deployments signed in, name the
    // one this profile uses rather than letting the host offer a list on which
    // only one entry can work.
    assert.deepEqual(asked, [{ kind: "known", account: signedIn }]);
  });

  it("signs in afresh when this deployment has no account yet", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const asked: AuthRequest[] = [];
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: {
        accounts: () => Promise.resolve([account("https://other.example.com")]),
        authSession: (request) => {
          asked.push(request);
          return Promise.resolve(authSession());
        },
      },
    });

    assert.ok(await manager.connect(), "the connect produced no session");

    // Which is as far as this tier can see. What `new` *becomes* — and in
    // particular that it clears the account the host would otherwise substitute
    // — is asserted in `test/unit/auth-session-request.test.ts`, because the
    // port injected above is what stands in for `getSession` here.
    assert.deepEqual(asked, [{ kind: "new" }]);
  });

  it("does not guess between two people signed in to one deployment", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const asked: AuthRequest[] = [];
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: {
        accounts: () =>
          Promise.resolve([account(ENDPOINT, "one"), account(ENDPOINT, "two")]),
        authSession: (request) => {
          asked.push(request);
          return Promise.resolve(authSession());
        },
      },
    });

    assert.ok(await manager.connect(), "the connect produced no session");

    // An account id names a user the profile does not, so this is unanswerable.
    // Asking is the safe half of the ambiguity; borrowing one of the two would
    // spend somebody else's token under this connect.
    assert.deepEqual(asked, [{ kind: "new" }]);
  });

  it("renews the token silently as the account it connected as", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const asked: AuthRequest[] = [];
    const signedIn = account();
    let issued: (() => string | Promise<string>) | undefined;
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: {
        accounts: () => Promise.resolve([signedIn]),
        authSession: (request) => {
          asked.push(request);
          return Promise.resolve(authSession());
        },
        createClient: (config) => {
          issued = config.token;
          return scripted.client;
        },
      },
    });

    assert.notEqual(await manager.connect(), undefined);
    await issued?.();

    // The path with no user in front of it, and therefore the one that would go
    // unreported: a session outlives its access token, and a refresh that did
    // not name the account could come back holding another deployment's.
    assert.deepEqual(asked, [
      { kind: "known", account: signedIn },
      { kind: "silent", account: signedIn },
    ]);
  });

  it("refuses when the signed-in account is not the active profile's", async () => {
    const scripted = deployment({});
    const { manager, shown } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: {
        authSession: () => Promise.resolve(authSession("another-profile")),
      },
    });

    assert.equal(await manager.connect(), undefined);
    // `getSession` picks the account, not us. Connecting to the deployment the
    // user did not select would be worse than refusing, so this names the
    // command that fixes it.
    assert.equal(scripted.requests.length, 0);
    assert.match(shown.errors[0] ?? "", /Switch Connection Profile/);
  });

  it("stops quietly when the user cancels the sign-in it asked for", async () => {
    // Connecting while signed out opens the browser, and closing the browser is
    // an answer. `getSession` has no way to say "cancelled" other than by
    // rejecting, so this arrives as a rejection and is turned back into the
    // `undefined` that every other "no session" answer already uses — which is
    // what stops it surfacing as *Running the contributed command … failed*.
    const scripted = deployment({});
    const { manager, shown } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: {
        authSession: () => Promise.reject(new SignInCancelledError()),
      },
    });

    assert.equal(await manager.connect(), undefined);
    assert.equal(scripted.requests.length, 0, "a cancelled connect asked Viya");
    assert.deepEqual(shown.errors, []);
    assert.deepEqual(shown.infos, []);
  });

  it("still raises a sign-in failure that is not a cancellation", async () => {
    // The direction that would be silent if the check were too generous. This
    // rejection is deliberately still a rejection: reporting a deployment that
    // could not be reached is #130's to improve, and swallowing it here would
    // close that defect by hiding it.
    const scripted = deployment({});
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: {
        authSession: () =>
          Promise.reject(new Error("the deployment could not be reached")),
      },
    });

    await assert.rejects(manager.connect(), /could not be reached/);
  });

  it("says nothing when the user cancels", async () => {
    const source = new vscode.CancellationTokenSource();
    const scripted = deployment({
      contexts: {
        ok: false,
        reason: "could not reach the compute service",
        problem: {
          code: "compute-unreachable",
          detail: "GET /compute/contexts — This operation was aborted",
        },
      },
    });
    const { manager, shown } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
      deps: {
        withProgress: (_title, run) => {
          source.cancel();
          return run(source.token);
        },
      },
    });

    assert.equal(await manager.connect(), undefined);
    // An aborted request arrives as `compute-unreachable`, whose message is
    // about the deployment being unreachable — true for a dropped connection
    // and misleading for someone who pressed Cancel.
    assert.deepEqual(shown.errors, []);
  });

  it("says nothing when the user cancels the context list", async () => {
    const source = new vscode.CancellationTokenSource();
    const scripted = deployment({
      contexts: {
        ok: false,
        reason: "could not reach the compute service",
        problem: {
          code: "compute-unreachable",
          detail: "GET /compute/contexts — This operation was aborted",
        },
      },
    });
    // No `context` on the profile, so the picker path runs and lists contexts
    // under a progress of its own. That token used to be unreachable from the
    // failure branch, which is how this arm came to report a cancellation as an
    // unreachable deployment while every other arm handled it correctly.
    const { manager, shown } = harness({
      profiles: profileSource(profile()),
      client: scripted.client,
      deps: {
        withProgress: (_title, run) => {
          source.cancel();
          return run(source.token);
        },
      },
    });

    assert.equal(await manager.connect(), undefined);

    assert.deepEqual(shown.errors, []);
    assert.deepEqual(shown.infos, []);
  });

  it("ends the session and forgets it on disconnect", async () => {
    const state = memoryMemento();
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
      delete: {
        ok: true,
        value: { status: 204, notModified: false, text: "", body: undefined },
      },
    });
    const profiles = profileSource(profile({ context: CONTEXT }));
    const { manager, bindings } = harness({
      profiles,
      client: scripted.client,
      state,
    });
    await manager.connect();

    await manager.disconnect();

    assert.ok(scripted.hrefs.includes(SESSION_PATH));
    assert.equal(bindings.read(PROFILE_ID), undefined);
    assert.equal(manager.current(PROFILE_ID), undefined);
  });

  it("says so when there is nothing to disconnect", async () => {
    const scripted = deployment({});
    const { manager, shown } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
    });

    await manager.disconnect();

    assert.equal(scripted.requests.length, 0);
    assert.equal(shown.infos.length, 1);
  });

  it("waits for a connect in flight before deciding there is nothing to end", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replies: Partial<Record<string, ComputeResult<ComputeResponse>>> = {
      ...viya4Probe(),
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
      delete: {
        ok: true,
        value: { status: 204, notModified: false, text: "", body: undefined },
      },
    };
    const hrefs: string[] = [];
    const client: ComputeClient = {
      send: async (request) => {
        hrefs.push(request.link.href);
        // Only the connect's own calls are held; the delete that disconnect
        // makes afterwards must not deadlock on a promise already resolved.
        if (request.link.rel !== "delete") await held;
        const reply = replies[request.link.rel];
        assert.ok(reply !== undefined);
        return reply;
      },
    };
    const state = memoryMemento();
    const { manager, bindings, shown } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client,
      state,
    });

    const connecting = manager.connect();
    const disconnecting = manager.disconnect();
    release();
    await Promise.all([connecting, disconnecting]);

    // Without the join, disconnect finds an empty map, says "there is no
    // session", and the connect it raced then leaves one running — the user
    // having been told the opposite of what happened.
    assert.deepEqual(shown.infos, []);
    assert.ok(hrefs.includes(SESSION_PATH), "the session was never deleted");
    assert.equal(manager.current(PROFILE_ID), undefined);
    assert.equal(bindings.read(PROFILE_ID), undefined);
  });

  it("leaves the session running when the window goes away", async () => {
    const scripted = deployment({
      contexts: ok(contextsBody()),
      createSession: ok(sessionBody(), 201),
    });
    const { manager } = harness({
      profiles: profileSource(profile({ context: CONTEXT })),
      client: scripted.client,
    });
    await manager.connect();
    const before = scripted.requests.length;

    manager.dispose();

    // ADR-0012: persisting an id so a reload can reconnect and deleting the
    // session on exit are contradictory, and a reload is the case the
    // persistence exists for.
    assert.equal(scripted.requests.length, before);
  });

  /**
   * Stage-1 capability probing, from the host's side.
   *
   * `probeCadence` itself is covered exhaustively at the unit tier — every shape
   * a 404 comes in, and which of them may and may not mean Viya 3.5. What is
   * only reachable here is the wiring: that it happens after a session and not
   * before, that its answer reaches the connection, that it is asked once per
   * profile, and that it cannot take a working connection down with it.
   */
  describe("version probing", () => {
    /** Ends the session, so the next `connect` is not answered from `live`. */
    async function reconnect(manager: ComputeSessionManager): Promise<void> {
      await manager.disconnect();
      await manager.connect();
    }

    it("carries the deployment's cadence version on the connection", async () => {
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
      });
      const { manager } = harness({
        profiles: profileSource(profile({ context: CONTEXT })),
        client: scripted.client,
      });

      const connection = await manager.connect();

      assert.ok(connection, "connecting produced no session");
      assert.equal(connection.generation.dialect.id, "viya4");
      assert.deepEqual(connection.generation.dialect.deployment, {
        kind: "viya4",
        release: RELEASE,
      });
      assert.ok(connection.generation.certain);
    });

    it("reads a deployment that offers no cadence relation as Viya 3.5", async () => {
      // A Viya service answered, with a document of the right shape, and it does
      // not advertise the relation. That is the one positive signal Viya 3.5
      // gives — the endpoint is a Viya 4 addition.
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
        deploymentData: ok(deploymentDataBody([])),
      });
      const { manager } = harness({
        profiles: profileSource(profile({ context: CONTEXT })),
        client: scripted.client,
      });

      const connection = await manager.connect();

      assert.ok(connection);
      assert.equal(connection.generation.dialect.id, "viya35");
      assert.ok(connection.generation.certain);
      // Nothing followed: there was no relation to follow.
      assert.ok(!scripted.hrefs.includes(CADENCE_PATH));
    });

    it("assumes Viya 4 without claiming it when the version cannot be read", async () => {
      // `gone()` is a bodyless 404 — the shape finding 42 records an *ingress*
      // producing for a path no service is routed to. A proxy, a VPN portal or a
      // mistyped host produces the same thing, so it must never be read as "this
      // deployment has no cadence endpoint, therefore Viya 3.5".
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
        deploymentData: gone(),
      });
      const { manager, shown } = harness({
        profiles: profileSource(profile({ context: CONTEXT })),
        client: scripted.client,
      });

      const connection = await manager.connect();

      assert.ok(connection, "a failed probe took the connection down with it");
      assert.equal(connection.generation.dialect.id, "viya4");
      assert.ok(!connection.generation.certain);
      // The Viya 4 dialect bound to an `unknown` deployment: we will speak Viya 4
      // to it, and we do not know what it is. Nothing downstream inherits a
      // confidence nobody earned.
      assert.deepEqual(connection.generation.dialect.deployment, {
        kind: "unknown",
      });
      // Probing is decoration. The user asked to connect, and they connected.
      assert.deepEqual(shown.errors, []);
    });

    it("survives a client that rejects rather than answering", async () => {
      // The residue `probeCadence`'s one sanctioned `catch` exists for. A
      // rejection escaping here would fail a connect that had already succeeded.
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
      });
      const client: ComputeClient = {
        send: async (request) => {
          if (request.link.rel === "deploymentData") {
            throw new Error("the socket closed");
          }
          return await scripted.client.send(request);
        },
      };
      const { manager, shown } = harness({
        profiles: profileSource(profile({ context: CONTEXT })),
        client,
      });

      const connection = await manager.connect();

      assert.ok(
        connection,
        "a throwing probe took the connection down with it",
      );
      assert.ok(!connection.generation.certain);
      assert.deepEqual(shown.errors, []);
    });

    it("asks the deployment its version once, however often it reconnects", async () => {
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
        delete: deleted(),
      });
      const { manager } = harness({
        profiles: profileSource(profile({ context: CONTEXT })),
        client: scripted.client,
      });

      await manager.connect();
      await reconnect(manager);

      // Two connects, two sessions, one version check. A deployment does not
      // change generation between one session and the next, and re-asking would
      // be two round trips to re-learn a fact that changes about once a quarter.
      assert.equal(
        scripted.hrefs.filter((href) => href === DEPLOYMENT_DATA_PATH).length,
        1,
      );
      assert.ok(manager.current(PROFILE_ID)?.generation.certain);
    });

    it("does not remember a version it could not determine", async () => {
      // The direction that matters more than the caching. `certain: false` is a
      // report about one attempt, not a finding about the deployment — cache it
      // and a proxy that was in the way for a moment decides how this window
      // talks to Viya until it is reloaded.
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
        delete: deleted(),
      });
      let asked = 0;
      const client: ComputeClient = {
        send: async (request) => {
          if (request.link.rel === "deploymentData") {
            asked += 1;
            if (asked === 1) return gone();
          }
          return await scripted.client.send(request);
        },
      };
      const { manager } = harness({
        profiles: profileSource(profile({ context: CONTEXT })),
        client,
      });

      await manager.connect();
      await reconnect(manager);

      assert.equal(asked, 2, "an inconclusive probe was cached");
      assert.ok(manager.current(PROFILE_ID)?.generation.certain);
    });

    it("asks again when the profile is pointed at another deployment", async () => {
      // A profile is a settings entry the user edits in place. Repoint one and
      // the id it keeps would otherwise answer for the deployment it used to
      // name — the same edit `rememberContext` guards against.
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
        delete: deleted(),
      });
      const profiles = profileSource(profile({ context: CONTEXT }));
      const { manager } = harness({
        profiles,
        client: scripted.client,
      });

      await manager.connect();
      profiles.replace(
        PROFILE_NAME,
        profile({ endpoint: "https://other.example.com", context: CONTEXT }),
      );
      await reconnect(manager);

      assert.equal(
        scripted.hrefs.filter((href) => href === DEPLOYMENT_DATA_PATH).length,
        2,
      );
    });

    it("says which generation it found and why", async () => {
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
      });
      const log = recordingLog("session manager version");
      const { manager } = harness({
        profiles: profileSource(profile({ context: CONTEXT })),
        client: scripted.client,
        log: log.channel,
      });

      await manager.connect();

      // The whole point of the wiring: a wrong dialect presents as a dozen
      // unrelated bugs, and this line is what makes it diagnosable from a bug
      // report. The release, and the display name the release alone is half of.
      const line = log.lines.find(({ message }) =>
        message.includes("SAS Viya version"),
      );
      assert.ok(line, "the version was not logged");
      assert.equal(line.level, "info");
      assert.match(line.message, /Viya 4 2026\.03/);
      assert.match(line.message, /Long-Term Support 2026\.03/);
    });

    it("warns, and says what it saw, when the version was assumed", async () => {
      const scripted = deployment({
        contexts: ok(contextsBody()),
        createSession: ok(sessionBody(), 201),
        deploymentData: gone(),
      });
      const log = recordingLog("session manager version assumed");
      const { manager } = harness({
        profiles: profileSource(profile({ context: CONTEXT })),
        client: scripted.client,
        log: log.channel,
      });

      await manager.connect();

      const line = log.lines.find(({ message }) =>
        message.includes("SAS Viya version"),
      );
      assert.ok(line, "the assumption was not logged");
      // The level is the certainty: everything after this is done on a guess.
      assert.equal(line.level, "warn");
      assert.match(line.message, /assumed/);
      // And the detail `deploymentFromSignal` throws away, which is the
      // difference between a proxy in the way and a real Viya 3.5.
      assert.match(line.message, /404/);
    });
  });

  /**
   * The seam 3a's run path claims before submitting, and releases when done.
   *
   * No job, no `createJob`, no fake job lifecycle: `startSubmission` and
   * `endSubmission` are plain state keyed on a profile id, so they are
   * testable without a deployment at all. What matters here is the refusal
   * itself, that it is per profile, and that ending a claim that was never
   * held is not an error.
   */
  describe("submission guard", () => {
    it("refuses a second submission while one is already claimed", () => {
      const { manager } = harness({
        profiles: profileSource(),
        client: deployment({}).client,
      });

      assert.equal(manager.startSubmission(PROFILE_ID), true);
      assert.equal(manager.isBusy(PROFILE_ID), true);
      // The second claim is refused, and the first is left exactly as it was.
      assert.equal(manager.startSubmission(PROFILE_ID), false);
      assert.equal(manager.isBusy(PROFILE_ID), true);
    });

    it("allows a new submission once the previous one ends", () => {
      const { manager } = harness({
        profiles: profileSource(),
        client: deployment({}).client,
      });

      assert.equal(manager.startSubmission(PROFILE_ID), true);
      manager.endSubmission(PROFILE_ID);

      assert.equal(manager.isBusy(PROFILE_ID), false);
      assert.equal(manager.startSubmission(PROFILE_ID), true);
    });

    it("keeps two profiles' claims independent", () => {
      const { manager } = harness({
        profiles: profileSource(),
        client: deployment({}).client,
      });

      assert.equal(manager.startSubmission(PROFILE_ID), true);

      // A different profile id is a different claim entirely — one profile's
      // running job must never block another profile's from starting.
      assert.equal(manager.startSubmission(OTHER_NAME), true);
      assert.equal(manager.isBusy(OTHER_NAME), true);
      assert.equal(manager.isBusy(PROFILE_ID), true);
    });

    it("treats ending an unheld claim as a no-op, not an error", () => {
      const { manager } = harness({
        profiles: profileSource(),
        client: deployment({}).client,
      });

      // Never started at all.
      assert.doesNotThrow(() => {
        manager.endSubmission(PROFILE_ID);
      });
      assert.equal(manager.isBusy(PROFILE_ID), false);

      // Started, ended, then ended again — the second end is what a `finally`
      // guarding an already-cleaned-up claim would produce, and it must not
      // throw either.
      manager.startSubmission(PROFILE_ID);
      manager.endSubmission(PROFILE_ID);
      assert.doesNotThrow(() => {
        manager.endSubmission(PROFILE_ID);
      });
      assert.equal(manager.isBusy(PROFILE_ID), false);
    });

    it("reports no profile as busy before anything has claimed one", () => {
      const { manager } = harness({
        profiles: profileSource(),
        client: deployment({}).client,
      });

      assert.equal(manager.isBusy(PROFILE_ID), false);
    });
  });
});
