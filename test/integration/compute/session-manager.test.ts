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
import { SessionBindingStore } from "../../../src/compute/bindingStore";
import {
  ComputeSessionManager,
  type ComputeProfileSource,
  type ComputeSessionDeps,
} from "../../../src/compute/sessionManager";
import type { ViyaProfile } from "../../../src/profile/model";
import { memoryMemento, testLogChannel } from "../../helpers/auth-host";

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
const CONTEXT = "SAS Job Execution compute context";
const CONTEXT_ID = "00000000-0000-4000-8000-0000000000c1";
const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;

function profile(init?: Partial<ViyaProfile>): ViyaProfile {
  return {
    version: 1,
    id: init?.id ?? PROFILE_ID,
    endpoint: init?.endpoint ?? "https://viya.example.com",
    ...(init?.context === undefined ? {} : { context: init.context }),
  };
}

interface Profiles extends ComputeProfileSource {
  /** Every `upsert` the manager made, so the context write-back is assertable. */
  readonly written: { name: string; profile: ViyaProfile }[];
}

function profileSource(current?: ViyaProfile): Profiles {
  const written: { name: string; profile: ViyaProfile }[] = [];
  let held = current;
  return {
    written,
    active: () =>
      held === undefined ? undefined : { name: PROFILE_NAME, profile: held },
    activeName: () => (held === undefined ? undefined : PROFILE_NAME),
    upsert: (name: string, next: ViyaProfile) => {
      written.push({ name, profile: next });
      held = next;
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

interface Deployment {
  readonly requests: ComputeRequest[];
  readonly client: ComputeClient;
  /** Hrefs requested, in order — the shortest form of "what did it do". */
  readonly hrefs: string[];
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
  return {
    requests,
    hrefs,
    client: {
      send: (request) => {
        requests.push(request);
        hrefs.push(request.link.href);
        const reply = replies[request.link.rel];
        assert.ok(
          reply !== undefined,
          `nothing was scripted for the "${request.link.rel}" link (${request.link.href})`,
        );
        return Promise.resolve(reply);
      },
    },
  };
}

/** An authentication session whose id is the profile's, as the provider issues it. */
function authSession(id = PROFILE_ID): vscode.AuthenticationSession {
  return {
    id,
    accessToken: "access-token-placeholder",
    account: { id: "user@example.com", label: "user@example.com" },
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
}): {
  manager: ComputeSessionManager;
  bindings: SessionBindingStore;
  shown: Shown;
} {
  const log = testLogChannel("session manager");
  const state = init.state ?? memoryMemento();
  const bindings = new SessionBindingStore(state, log);
  const shown: Shown = { errors: [], infos: [] };

  const manager = new ComputeSessionManager(init.profiles, bindings, log, {
    isTrusted: () => true,
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

  it("joins a connect that is already running rather than starting a second session", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replies: Partial<Record<string, ComputeResult<ComputeResponse>>> = {
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
    // One request, straight at the session. The stored id is used rather than
    // checked: a probe first would cost the same round trip and answer nothing.
    assert.deepEqual(scripted.hrefs, [SESSION_PATH]);
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
});
