// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { NoSuchSessionError } from "../../../src/auth/authProvider";
import { SignInCancelledError } from "../../../src/auth/cancellation";
import {
  signIn,
  signOut,
  type SignInDeps,
  type SignOutDeps,
} from "../../../src/auth/commands";
import { testLogChannel } from "../../helpers/auth-host";
import { extensionId } from "../../helpers/manifest";

/**
 * The two auth commands, as the command palette sees them.
 *
 * This is also the only place anything in the suite touches the *real*
 * `SecretStorage`: `pythonOnViya.signOut` runs inside the activated extension,
 * against the `SessionStore` built on `context.secrets` in `activate`. There is
 * no way to read that store back from here, so what is proven is narrower than
 * the round-trip next door — that the real keychain accepts the call and the
 * command returns. It is worth having anyway, because a `delete` against a
 * keychain entry that was never written is exactly the kind of thing that throws
 * on one platform and not another.
 *
 * **`pythonOnViya.signIn` is deliberately not run with a profile configured.**
 * It would open a real browser and then block on a modal that no test can answer,
 * and the twenty-second timeout would be the only thing to end it. The flow
 * behind it is driven end to end in `browser-flow.test.ts`, where the browser and
 * the box are ports. What is left to test here is the arm that refuses before any
 * of that: no active profile, nothing to sign in to.
 *
 * The suite below the palette tests calls the `signIn` handler directly, with the
 * provider, the profile store, the connect and the notifications as ports. It has
 * to: the palette ids belong to the activated extension, so registering a second
 * copy of the handler is not possible, and running the real one would open a
 * browser. Nothing here reaches a deployment.
 *
 * **Not testable from here, and true by construction: the Accounts menu does not
 * connect.** The connect lives in this command, and `AuthProvider` has no way to
 * reach a compute session — no import, no port, nothing to stub. The test that
 * would prove it is the absence of a dependency.
 */

const SECTION = "pythonOnViya";

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

async function set(key: string, value: unknown): Promise<void> {
  await config().update(key, value, vscode.ConfigurationTarget.Global);
}

describe("sign-in and sign-out commands", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension, `${extensionId()} is not loaded`);
    await extension.activate();
  });

  afterEach(async () => {
    // The host reuses one user-data directory for the whole run, so a profile
    // left behind is a profile the next suite has to reason about.
    await set("connectionProfiles", undefined);
    await set("defaultProfile", undefined);
  });

  it("contributes both commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ["pythonOnViya.signIn", "pythonOnViya.signOut"]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });

  it("declares both commands under the extension's category", () => {
    // Without a category they appear in the palette as bare "Sign In" and "Sign
    // Out", next to every other extension's.
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);

    const contributed = commandContributions(extension);
    for (const id of ["pythonOnViya.signIn", "pythonOnViya.signOut"]) {
      const entry = contributed.find((command) => command.command === id);
      assert.ok(entry, `${id} is not in contributes.commands`);
      assert.ok(entry.title, `${id} has no title`);
      assert.ok(entry.category, `${id} has no category`);
      // Enablement keeps them out of the palette until there is a profile —
      // the same condition the profile commands use — and until the folder is
      // trusted. The trust half is not decoration: the provider throws on both
      // of these paths in an untrusted folder, and a palette entry that is
      // guaranteed to fail is worse than one that is not offered.
      assert.equal(
        entry.enablement,
        "pythonOnViya.hasProfiles && isWorkspaceTrusted",
      );
    }
  });

  it("refuses to sign in when no profile is selected", async () => {
    // The state every new install starts in. It reaches an information message
    // and returns; a command that throws on first use is the worst possible
    // first impression.
    await vscode.commands.executeCommand("pythonOnViya.signIn");
  });

  it("signs out of nothing without complaining", async () => {
    await vscode.commands.executeCommand("pythonOnViya.signOut");
  });

  it("clears a session through the real keychain", async () => {
    await set("connectionProfiles", {
      Prod: {
        version: 1,
        id: "auth-commands-integration",
        endpoint: "https://viya.example.com",
      },
    });
    await set("defaultProfile", "Prod");

    // No session was ever stored for this id, which is the case worth running:
    // signing out has to be safe when there is nothing to delete.
    await vscode.commands.executeCommand("pythonOnViya.signOut");
  });
});

const PROFILE_ID = "auth-commands-sign-in";
const PROFILE_NAME = "Prod";

/**
 * What a connect gives this command back.
 *
 * The profile name and nothing else, because that is all `ConnectAfterSignIn`
 * asks for — building a whole `ComputeConnection` here would mean a fake compute
 * client and a fake session for a message that names neither.
 */
function connection(): { readonly profileName: string } {
  return { profileName: PROFILE_NAME };
}

function session(): vscode.AuthenticationSession {
  return {
    id: PROFILE_ID,
    accessToken: "access-token-placeholder",
    account: { id: "account-id-placeholder", label: "user@example.com" },
    scopes: [],
  };
}

interface SignInHarness {
  readonly deps: SignInDeps;
  /** One entry per connect attempt, so "did not connect" is countable. */
  readonly connects: number[];
  readonly informed: string[];
  readonly reported: string[];
}

function signInHarness(init?: {
  active?: boolean;
  connected?: { readonly profileName: string } | undefined;
  createSession?: () => Promise<vscode.AuthenticationSession>;
}): SignInHarness {
  const connects: number[] = [];
  const informed: string[] = [];
  const reported: string[] = [];
  const active =
    init?.active === false
      ? undefined
      : {
          name: PROFILE_NAME,
          profile: {
            version: 1 as const,
            id: PROFILE_ID,
            endpoint: "https://viya.example.com",
          },
        };

  return {
    connects,
    informed,
    reported,
    deps: {
      provider: {
        createSession:
          init?.createSession ?? (() => Promise.resolve(session())),
      },
      profiles: { active: () => active },
      log: testLogChannel("auth commands"),
      connect: () => {
        connects.push(connects.length);
        return Promise.resolve(init?.connected);
      },
      inform: (message) => informed.push(message),
      report: (message) => reported.push(message),
    },
  };
}

describe("signing in connects", () => {
  it("opens a session, and says both things in one message", async () => {
    const h = signInHarness({ connected: connection() });

    await signIn(h.deps);

    assert.equal(h.connects.length, 1, "signing in did not connect");
    // One notification, not two. The user ran one command and the outcome is one
    // sentence; a second toast for the half they did not ask about separately is
    // noise, and the profile name is the part that says *where* they landed.
    assert.equal(h.informed.length, 1);
    assert.match(h.informed[0] ?? "", /user@example\.com/);
    assert.match(h.informed[0] ?? "", /Prod/);
    assert.deepEqual(h.reported, []);
  });

  it("still says the sign-in worked when the connect does not happen", async () => {
    // The manager returns undefined for a cancelled connect and for a failed one,
    // and has already spoken in both cases. What it cannot say is that the
    // sign-in itself succeeded — so this is the one fact left to report, and
    // reporting it is what stops the user signing in a second time.
    const h = signInHarness({ connected: undefined });

    await signIn(h.deps);

    assert.equal(h.connects.length, 1);
    assert.equal(h.informed.length, 1);
    assert.match(h.informed[0] ?? "", /Signed in to SAS Viya/);
    assert.doesNotMatch(h.informed[0] ?? "", /connected/i);
  });

  it("does not connect when there is no profile to sign in to", async () => {
    const h = signInHarness({ active: false, connected: connection() });

    await signIn(h.deps);

    assert.deepEqual(h.connects, [], "connected without a profile");
    assert.match(h.informed[0] ?? "", /connection profile/);
  });

  it("does not connect when the sign-in failed", async () => {
    // The ordering that matters: a failed sign-in has no token, so a connect
    // after it would open a browser for a second sign-in the user did not ask
    // for, on top of an error message about the first.
    const h = signInHarness({
      connected: connection(),
      createSession: () => Promise.reject(new Error("the deployment refused")),
    });

    await signIn(h.deps);

    assert.deepEqual(h.connects, [], "connected without a session");
    assert.deepEqual(h.informed, []);
    assert.match(h.reported[0] ?? "", /the deployment refused/);
  });
});

describe("cancelling a sign-in", () => {
  it("shows nothing at all", async () => {
    // Closing the browser is an answer. An error dialog for it tells the user
    // that the thing they just chose to do has gone wrong, and there is nothing
    // to fix — so no dialog, and no information message either, because a toast
    // confirming that nothing happened is still a toast.
    const h = signInHarness({
      connected: connection(),
      createSession: () => Promise.reject(new SignInCancelledError()),
    });

    await signIn(h.deps);

    assert.deepEqual(h.reported, [], "a cancellation reached an error dialog");
    assert.deepEqual(h.informed, []);
    assert.deepEqual(h.connects, [], "connected after a cancelled sign-in");
  });

  it("is still recognised after the editor has rebuilt the error", async () => {
    // The shape that arrives when the rejection has crossed an RPC hop: a plain
    // `Error` carrying the name, with the prototype gone. Not the path this
    // command takes — it holds the provider directly — but it is the path the
    // compute connect takes, and both use this one predicate. A check that only
    // worked here would keep passing while the other one rotted.
    const revived = new Error("Signing in to SAS Viya was cancelled.");
    revived.name = "SignInCancelledError";

    const h = signInHarness({ createSession: () => Promise.reject(revived) });

    await signIn(h.deps);

    assert.deepEqual(h.reported, []);
    assert.deepEqual(h.informed, []);
  });

  it("still reports a failure that is not a cancellation", async () => {
    // The direction that would be silent if the predicate were too generous.
    const h = signInHarness({
      createSession: () =>
        Promise.reject(new Error("the deployment could not be reached")),
    });

    await signIn(h.deps);

    assert.match(h.reported[0] ?? "", /could not be reached/);
  });
});

interface SignOutHarness {
  readonly deps: SignOutDeps;
  /** Every `provider`/`disconnect` call in call order, so ordering is
   * assertable — `"disconnect"` must precede `"removeSession"`. */
  readonly calls: string[];
  readonly informed: string[];
  readonly reported: string[];
}

function signOutHarness(init?: {
  active?: boolean;
  removeSession?: () => Promise<void>;
  disconnect?: () => Promise<void>;
}): SignOutHarness {
  const calls: string[] = [];
  const informed: string[] = [];
  const reported: string[] = [];
  const active =
    init?.active === false
      ? undefined
      : {
          name: PROFILE_NAME,
          profile: {
            version: 1 as const,
            id: PROFILE_ID,
            endpoint: "https://viya.example.com",
          },
        };

  return {
    calls,
    informed,
    reported,
    deps: {
      provider: {
        removeSession: async (id) => {
          calls.push("removeSession");
          assert.equal(id, PROFILE_ID);
          await (init?.removeSession?.() ?? Promise.resolve());
        },
      },
      profiles: { active: () => active },
      log: testLogChannel("auth commands"),
      disconnect: async () => {
        calls.push("disconnect");
        await (init?.disconnect?.() ?? Promise.resolve());
      },
      inform: (message) => informed.push(message),
      report: (message) => reported.push(message),
    },
  };
}

describe("signing out disconnects", () => {
  it("ends the session before removing the credential, and says so once", async () => {
    // Order is load-bearing: the DELETE that ends the SAS session needs the
    // token `removeSession` is about to delete. Reversed, every sign-out
    // orphans its session until the idle reaper and logs a spurious warning.
    const h = signOutHarness();

    await signOut(h.deps);

    assert.deepEqual(h.calls, ["disconnect", "removeSession"]);
    assert.equal(h.informed.length, 1, "one confirmation toast, not two");
    assert.match(h.informed[0] ?? "", /Prod/);
    assert.deepEqual(h.reported, []);
  });

  it("disconnects even when there is no session, without a second toast", async () => {
    // `disconnect` is bound to its quiet mode in `extension.ts`; the fake
    // here stands in for that. The command must still call it — the point
    // is that it re-syncs `pythonOnViya.connected` — but a user who ran
    // Sign Out gets one message, not a "nothing to disconnect" one too.
    const h = signOutHarness();

    await signOut(h.deps);

    assert.ok(h.calls.includes("disconnect"), "sign-out did not disconnect");
    assert.equal(h.informed.length, 1);
  });

  it("still disconnects when the credential was already gone", async () => {
    // `removeSession` throwing `NoSuchSessionError` is the ordinary "nothing
    // there to sign out of" case. The disconnect ran first regardless, so
    // the context key is re-synced even on this path.
    const h = signOutHarness({
      removeSession: () => Promise.reject(new NoSuchSessionError("gone")),
    });

    await signOut(h.deps);

    assert.deepEqual(h.calls, ["disconnect", "removeSession"]);
    assert.match(h.informed[0] ?? "", /not signed in/);
    assert.deepEqual(h.reported, []);
  });

  it("reports a real sign-out failure and does not claim success", async () => {
    const h = signOutHarness({
      removeSession: () =>
        Promise.reject(new Error("the secret store would not delete")),
    });

    await signOut(h.deps);

    assert.match(h.reported[0] ?? "", /would not delete/);
    assert.doesNotMatch(h.informed.join(" "), /Signed out/);
  });

  it("does nothing when there is no profile to sign out of", async () => {
    const h = signOutHarness({ active: false });

    await signOut(h.deps);

    assert.deepEqual(h.calls, [], "acted without a profile");
    assert.match(h.informed[0] ?? "", /no connection profile/i);
  });
});

interface CommandContribution {
  command?: string;
  title?: string;
  category?: string;
  enablement?: string;
}

/**
 * The manifest's `contributes.commands`, read from the loaded extension rather
 * than from the file on disk — the packaged manifest is the one the palette uses.
 */
function commandContributions(
  extension: vscode.Extension<unknown>,
): CommandContribution[] {
  const packaged: unknown = extension.packageJSON as unknown;
  if (
    typeof packaged !== "object" ||
    packaged === null ||
    !("contributes" in packaged)
  ) {
    throw new Error("the loaded extension has no contributes section");
  }

  const section: unknown = packaged.contributes;
  if (
    typeof section !== "object" ||
    section === null ||
    !("commands" in section) ||
    !Array.isArray(section.commands)
  ) {
    throw new Error("the loaded extension contributes no commands");
  }

  return section.commands as CommandContribution[];
}
