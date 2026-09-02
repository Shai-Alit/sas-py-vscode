// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Slice 3d-i's commands: `selectRunTarget`, `Run File`, `Run Selection`,
 * `Cancel`, `Reset Python state`.
 *
 * This is the first module that ever constructs a `ProcPythonBackend` from a
 * live `ComputeConnection` — nothing before this slice turned a session into
 * something that can run Python. One backend is held per profile, reused
 * across runs for as long as the underlying `ComputeConnection` object is the
 * same one `ComputeSessionManager` hands back; a reconnect (a new session, a
 * new dialect resolution) gets a fresh backend rather than one carrying the
 * old session's fileref/run counters.
 *
 * ADR-0011 governs everything about *which* target a run goes to and how the
 * target is chosen; this module is what a chosen target actually does. Two
 * context keys this module owns and nothing else does:
 *
 *  - `pythonOnViya.runTarget` — `"local"` or `"viya"`, gating `package.json`'s
 *    `editor/title/run` and `editor/context` entries (ADR-0011).
 *  - `pythonOnViya.running` — whether *this window* currently has a run or a
 *    reset in flight, gating Cancel's enablement. Only one can be in flight
 *    at a time in a window (the backend is serial and this module only ever
 *    starts a second one after the first's promise settles), so a single
 *    module-scoped flag is the whole state, the same shape
 *    `pythonOnViya.connected` uses in `compute/commands.ts`.
 */

import * as vscode from "vscode";

import type { ExecutionHandle, Program, Traceback } from "../backend/backend";
import { localiseBackendProblem } from "../backend/messages";
import type { BackendProblem } from "../backend/problems";
import { ProcPythonBackend, type SubmissionGuard } from "../backend/procPython";
import type {
  ComputeConnection,
  ComputeSessionManager,
} from "../compute/sessionManager";
import type { ProfileStore } from "../profile/store";
import { RunDiagnostics } from "./diagnostics";
import {
  ENVIRONMENT_SCHEME,
  environmentDocumentUri,
  EnvironmentDocumentProvider,
} from "./environmentPanel";
import type { EnvironmentStore } from "./environmentStore";
import { RunOutputChannel } from "./outputChannel";
import { ResultPanel } from "./resultPanel";
import { runTargetPickEntries } from "./target";
import type { RunTargetStore } from "./targetStore";

/** Gates `editor/title/run` and `editor/context` (ADR-0011). */
export const RUN_TARGET_CONTEXT_KEY = "pythonOnViya.runTarget";
/** Gates the Cancel command's `enablement`. */
export const RUNNING_CONTEXT_KEY = "pythonOnViya.running";

/** What this module needs from `ProfileStore`, narrowed the same way every
 * other command module narrows it. */
export type RunCommandProfiles = Pick<
  ProfileStore,
  "names" | "get" | "setActiveName"
>;

/** What this module needs from `ComputeSessionManager`: connecting the
 * active profile, and the per-profile submission guard `procPython.ts`'s
 * `SubmissionGuard` is a narrowed port onto. */
export type RunCommandSessions = Pick<
  ComputeSessionManager,
  "connect" | "isBusy" | "startSubmission" | "endSubmission"
> & {
  /**
   * Drops this window's cached connection for a profile whose session a
   * run, reset or probe has just discovered is actually gone
   * (`BackendProblem` `backend-gone`), and re-syncs `pythonOnViya.connected`
   * — the same context key `src/compute/commands.ts`'s `connect`/
   * `disconnect` keep honest.
   *
   * Added 2026-08-28 (Phase 3's 3f slice), threaded from
   * `registerComputeCommands`'s own `forgetProfile` in `extension.ts`, so
   * the palette's Connect command comes back immediately once a dead
   * session is discovered, rather than staying hidden until the user finds
   * Disconnect first — the dead end the 2026-08-27 manual test pass hit
   * repeatedly.
   */
  forgetProfile: (profileId: string) => void;
};

/** What this module needs from `EnvironmentStore` — 3e's per-profile,
 * explicitly-refreshed cache of a stage-2 probe. */
export type RunCommandEnvironment = Pick<EnvironmentStore, "get" | "set">;

/** One backend per profile, held for as long as the connection it was built
 * from is still the live one. */
interface CachedBackend {
  readonly connection: ComputeConnection;
  readonly backend: ProcPythonBackend;
}

/**
 * The ports this module would otherwise reach for on the `vscode` namespace
 * directly. Same reasoning as `ComputeSessionDeps`: an integration test
 * cannot open a real editor, drive a real quick pick, or click a real
 * progress notification's Cancel button, so each is injectable and defaults
 * to the real thing.
 */
export interface RunCommandDeps {
  /** Defaults to `vscode.window.activeTextEditor`. */
  activeTextEditor?: (() => vscode.TextEditor | undefined) | undefined;
  /** Defaults to `vscode.window.showQuickPick`. */
  showQuickPick?:
    | (<T extends vscode.QuickPickItem>(
        items: readonly T[],
        options: vscode.QuickPickOptions,
      ) => Thenable<T | undefined>)
    | undefined;
  /** Defaults to `vscode.window.withProgress`. */
  withProgress?:
    | (<T>(
        location: vscode.ProgressLocation,
        title: string,
        cancellable: boolean,
        run: (
          progress: vscode.Progress<{ message?: string }>,
          token: vscode.CancellationToken,
        ) => Promise<T>,
      ) => Thenable<T>)
    | undefined;
  /** Defaults to `vscode.window.showInformationMessage`. */
  inform?: ((message: string) => void) | undefined;
  /** Defaults to `vscode.window.showErrorMessage`. */
  report?: ((message: string) => void) | undefined;
  /** Defaults to a fresh `RunOutputChannel`. Supplying one hands its
   * lifecycle to the caller — this module then leaves it off
   * `context.subscriptions`, so a test can inspect it after the fact without
   * it being disposed out from under it at suite teardown. */
  outputChannel?: RunOutputChannel | undefined;
  /** Defaults to a fresh `ResultPanel`. Same lifecycle rule as
   * `outputChannel` above, for the same reason. */
  resultPanel?: ResultPanel | undefined;
  /** Defaults to a fresh `RunDiagnostics` (Phase 4d — the Problems-panel
   * collection). Same lifecycle rule as `outputChannel`/`resultPanel`
   * above. */
  diagnostics?: RunDiagnostics | undefined;
  /** Defaults to a fresh `EnvironmentDocumentProvider`. Same lifecycle rule as
   * `outputChannel`/`resultPanel` above, for the same reason — and this one
   * additionally needs `registerRunCommands` to be the thing that calls
   * `vscode.workspace.registerTextDocumentContentProvider`, not this
   * constructor, matching how command registration itself was pulled out
   * after 3d-i's own `registerCommand` collision (this module's doc comment
   * explains that split in full). */
  environmentDocuments?: EnvironmentDocumentProvider | undefined;
}

/**
 * The five commands' behaviour, as callable functions — no
 * `vscode.commands.registerCommand` call among them.
 *
 * Command ids are process-global for the whole test host, and the real
 * extension claims all seven of this module's at activation (`onStartupFinished`
 * — see `extension.ts`'s own comment on that). Every other command module in
 * this codebase tests guard behaviour by exercising the underlying class
 * directly (`ComputeSessionManager`, `SessionStore`, …) rather than by trying
 * to register a second, fake-wired copy of an already-claimed command id —
 * `registerCommand` throws "command already exists" the moment it tries. This
 * function is `commands.ts`'s equivalent seam: a test builds handlers with its
 * own fakes and calls them directly, and `registerRunCommands` below is the
 * thin shell that wires the same handlers to the real registry — and, for 3e,
 * the real `TextDocumentContentProvider` registry too, for the same reason —
 * exactly once, at real activation.
 */
export interface RunCommandHandlers extends vscode.Disposable {
  readonly outputChannel: RunOutputChannel;
  readonly resultPanel: ResultPanel;
  readonly diagnostics: RunDiagnostics;
  readonly environmentDocuments: EnvironmentDocumentProvider;
  runFile(): Promise<void>;
  runSelection(): Promise<void>;
  cancelRun(): Promise<void>;
  resetPythonState(): Promise<void>;
  selectRunTarget(): Promise<void>;
  /** Opens the environment document, probing first if this profile has never
   * been probed. Uses the cache otherwise — see `PRODUCTION_PLAN.md` §2.3's
   * "explicit refresh" and `backend.ts`'s corrected `capabilities()` doc. */
  showEnvironment(): Promise<void>;
  /** Same document, but always re-probes first, even when a cached answer
   * already exists. */
  refreshEnvironment(): Promise<void>;
}

export function createRunCommandHandlers(
  sessions: RunCommandSessions,
  profiles: RunCommandProfiles,
  targets: RunTargetStore,
  environment: RunCommandEnvironment,
  log: vscode.LogOutputChannel,
  extensionUri: vscode.Uri,
  deps: RunCommandDeps = {},
): RunCommandHandlers {
  const outputChannel = deps.outputChannel ?? new RunOutputChannel();
  const resultPanel = deps.resultPanel ?? new ResultPanel(extensionUri);
  const diagnostics = deps.diagnostics ?? new RunDiagnostics();
  const environmentDocuments =
    deps.environmentDocuments ??
    new EnvironmentDocumentProvider((profileId) => environment.get(profileId));
  const backends = new Map<string, CachedBackend>();
  /** The one run this window can have in flight, so the Cancel command can
   * find its handle without the progress notification being the only thing
   * that knows it. `undefined` whenever no `execute()` is outstanding — never
   * set for a `reset()`, which produces no handle; see `cancelRun`'s own
   * comment for how that case is handled instead. */
  let currentRun:
    { backend: ProcPythonBackend; handle: ExecutionHandle } | undefined;
  /** The backend a `reset()` is currently running against, tracked the same
   * way `currentRun` tracks `execute()` — `reset()` itself returns no handle,
   * but nothing stops this module from remembering which backend it called
   * it on. Set for the duration of `resetPythonState`'s own call, cleared in
   * its `finally`. Codex's review on this PR found the previous design (no
   * tracking at all; `cancelRun`'s fallback re-derived "the busy backend" from
   * the *currently active* profile at cancel time) broke as soon as the run
   * target or active profile changed while the reset was still in flight —
   * the fallback would then look at the wrong profile's cache entry, or none,
   * and tell the user nothing was running while the reset kept going. */
  let currentReset: { backend: ProcPythonBackend } | undefined;

  const syncTargetContext = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      RUN_TARGET_CONTEXT_KEY,
      targets.kind(),
    );
  };
  const syncRunningContext = (value: boolean): void => {
    void vscode.commands.executeCommand(
      "setContext",
      RUNNING_CONTEXT_KEY,
      value,
    );
  };
  const targetChangeSubscription = targets.onDidChange(syncTargetContext);
  syncTargetContext();
  syncRunningContext(false);

  const activeEditor = (): vscode.TextEditor | undefined =>
    (deps.activeTextEditor ?? (() => vscode.window.activeTextEditor))();

  const pick = async <T extends vscode.QuickPickItem>(
    items: readonly T[],
    options: vscode.QuickPickOptions,
  ): Promise<T | undefined> => {
    const show = deps.showQuickPick;
    if (show !== undefined) return await show(items, options);
    return await vscode.window.showQuickPick([...items], options);
  };

  const showProgress = async <T>(
    location: vscode.ProgressLocation,
    title: string,
    cancellable: boolean,
    run: (
      progress: vscode.Progress<{ message?: string }>,
      token: vscode.CancellationToken,
    ) => Promise<T>,
  ): Promise<T> => {
    const show = deps.withProgress;
    if (show !== undefined)
      return await show(location, title, cancellable, run);
    return await vscode.window.withProgress(
      { location, title, cancellable },
      run,
    );
  };

  const inform = (message: string): void => {
    const show = deps.inform;
    if (show !== undefined) {
      show(message);
      return;
    }
    void vscode.window.showInformationMessage(message);
  };

  const report = (message: string): void => {
    const show = deps.report;
    if (show !== undefined) {
      show(message);
      return;
    }
    void vscode.window.showErrorMessage(message);
  };

  const guardFor = (profileId: string): SubmissionGuard => ({
    isBusy: () => sessions.isBusy(profileId),
    startSubmission: () => sessions.startSubmission(profileId),
    endSubmission: () => {
      sessions.endSubmission(profileId);
    },
  });

  /**
   * Connects the active profile and returns the backend for it, reusing one
   * already built from the same `ComputeConnection`. `undefined` means
   * `sessions.connect()` already reported why — a dead token, an untrusted
   * folder, no profile — and there is nothing further to say here.
   */
  const backendFor = async (): Promise<CachedBackend | undefined> => {
    const connection = await sessions.connect();
    if (connection === undefined) return undefined;

    const cached = backends.get(connection.profileId);
    if (cached?.connection === connection) {
      // Idempotent and I/O-free (`ExecutionBackend.connect()`'s own
      // contract) — always re-marking a cached backend connected is what
      // makes it safe to hand back one `cancelRun` closed underneath a
      // `reset()`: closing sets `connected = false` and there is no other
      // hook that would otherwise notice and reconnect it.
      await cached.backend.connect();
      return cached;
    }

    if (cached?.backend.busy) {
      // A reconnect landed while the old backend still had a run or a reset
      // in flight (a new `ComputeConnection` for the same profile — a
      // reattach, a new dialect resolution). Overwriting the cache entry
      // below would otherwise orphan it: `cancelRun`'s reset-interrupt path
      // only ever looks at what `backends` holds *now*, so the old backend
      // would keep running with nothing left able to reach it. Closing it
      // here is the same "cancel whatever is in flight, then disconnect"
      // `close()` already does for every other caller of it.
      await cached.backend.close();
    }

    const backend = new ProcPythonBackend(
      connection.client,
      connection.session,
      connection.generation.dialect,
      guardFor(connection.profileId),
      (reason) => {
        log.warn(reason);
      },
    );
    // Never performs I/O (ExecutionBackend's own contract) — this only marks
    // the backend ready to accept `execute()`/`reset()` calls.
    await backend.connect();

    const entry: CachedBackend = { connection, backend };
    backends.set(connection.profileId, entry);
    return entry;
  };

  const reportNotReady = (reason: "local" | "no-profile"): void => {
    report(
      reason === "local"
        ? vscode.l10n.t(
            "The run target is Local Python. Switch the run target to a SAS Viya profile to run this on Viya.",
          )
        : vscode.l10n.t(
            "No SAS Viya connection profile is selected. Select a run target before running.",
          ),
    );
  };

  const reportProblem = (problem: BackendProblem): void => {
    report(localiseBackendProblem(problem));
  };

  /**
   * When a call discovers the session itself is gone (`procPython.ts`'s
   * `translate()`, `backend-gone`), tells `src/compute` to drop its own
   * cached connection and re-sync `pythonOnViya.connected`. Added 2026-08-28
   * (Phase 3's 3f slice) — see `RunCommandSessions.forgetProfile`'s own doc
   * comment for why this exists.
   */
  const forgetIfGone = (problem: BackendProblem, profileId: string): void => {
    if (problem.code === "backend-gone") sessions.forgetProfile(profileId);
  };

  /** Builds a {@link Program} from the whole document, or from a non-empty
   * selection. `undefined` for an empty selection — there is nothing to run.
   *
   * `selection === undefined` is the *whole-file* call (`runNow(true)` passes
   * no selection at all, deliberately, regardless of what is highlighted in
   * the editor) — that is the only case that falls back to the whole
   * document. A defined-but-empty `Selection` is `runNow(false)`'s own "the
   * user ran Run Selection with nothing selected" case, and must return
   * `undefined` rather than silently running the whole file — the two were
   * folded into the same branch until this was caught by
   * `commands.test.ts`'s "tells the user to select code" guard actually
   * running end to end for the first time. */
  const buildProgram = (
    document: vscode.TextDocument,
    selection: vscode.Selection | undefined,
  ): Program | undefined => {
    if (selection === undefined) {
      return {
        bytes: new TextEncoder().encode(document.getText()),
        origin: { uri: document.uri, lineOffset: 0 },
      };
    }
    if (selection.isEmpty) return undefined;
    const text = document.getText(selection);
    if (text.trim() === "") return undefined;
    return {
      bytes: new TextEncoder().encode(text),
      origin: { uri: document.uri, lineOffset: selection.start.line },
    };
  };

  const baseName = (uri: vscode.Uri): string => {
    const segments = uri.path.split("/");
    return segments[segments.length - 1] ?? uri.path;
  };

  const runNow = async (whole: boolean): Promise<void> => {
    const readiness = targets.readiness();
    if (!readiness.ok) {
      reportNotReady(readiness.reason);
      return;
    }

    const editor = activeEditor();
    if (editor?.document.languageId !== "python") {
      inform(vscode.l10n.t("Open a Python file to run it on SAS Viya."));
      return;
    }

    const program = buildProgram(
      editor.document,
      whole ? undefined : editor.selection,
    );
    if (program === undefined) {
      inform(vscode.l10n.t("Select some code to run."));
      return;
    }

    const built = await backendFor();
    if (built === undefined) return;
    const { backend, connection } = built;

    // This check's own message is genuinely redundant with `execute()`'s own
    // `busy` refusal below (`localiseBackendProblem`'s `busy` arm ignores
    // `running` regardless of which one produced it, and this synthesized
    // value is never logged) — a review round found that and an initial fix
    // removed the check entirely on that basis. That was wrong: the check is
    // what stops a second invocation from ever reaching `syncRunningContext`,
    // `currentRun` and the try/finally below in the first place. Without it,
    // a second `Run File` fired while the first is still executing would
    // pass this point, `execute()` would correctly refuse it as busy, but
    // this invocation's own `finally` would still unconditionally clear
    // `currentRun` and flip `pythonOnViya.running` to `false` — out from
    // under the *first*, still-running invocation, which owns that state.
    // The message really is redundant; the serialisation is not. Caught by a
    // second review pass after the first fix landed.
    if (backend.busy) {
      reportProblem({ code: "busy", running: "a run in this window" });
      return;
    }

    const description = whole
      ? baseName(editor.document.uri)
      : vscode.l10n.t("the selection in {0}", baseName(editor.document.uri));

    syncRunningContext(true);
    try {
      const executed = await backend.execute(program, {
        freshNamespace: whole,
      });
      if (!executed.ok) {
        // Added 2026-08-28 (Phase 3's 3f slice): this call used to report the
        // problem without ever logging it, so the "See the Python on Viya
        // log for details" every one of these messages ends with was false
        // — the 2026-08-27 manual test pass hit this on almost every silent
        // failure it found. `executed.reason` is the same composed sentence
        // `showEnvironmentImpl`'s own probe-failure path already logs below.
        log.warn(executed.reason);
        forgetIfGone(executed.problem, connection.profileId);
        reportProblem(executed.problem);
        return;
      }

      outputChannel.reveal();
      outputChannel.writeRunHeader(connection.profileName, description);
      resultPanel.startRun(program.origin);
      // Phase 4d: reset the Problems entry alongside the other two surfaces,
      // at the point a run actually begins — not before `backendFor()`,
      // where a connect failure or a `busy` refusal would clear Problems
      // while the output channel and result panel still showed the previous
      // run. A run that now passes, or fails before producing a traceback,
      // leaves nothing stale; keyed on the origin URI, the key `publish` sets.
      diagnostics.clearFor(program.origin.uri);
      const handle = executed.value;
      currentRun = { backend, handle };

      // `ProgressLocation.Notification`, not `Window`: VS Code's own contract
      // is that only a notification's progress supports a cancel button — a
      // `Window`-located `cancellable: true` renders no button at all, so the
      // token below would never fire from the UI (only the Command Palette's
      // own Cancel command would ever reach it). Found on review.
      const traceback = await showProgress(
        vscode.ProgressLocation.Notification,
        vscode.l10n.t("Running {0} on SAS Viya…", description),
        true,
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() => {
            void backend.cancel(handle);
          });
          try {
            return await drainOutputs(handle, outputChannel, resultPanel);
          } finally {
            subscription.dispose();
          }
        },
      );

      const settled = await handle.done;
      if (!settled.ok) {
        // Same fix as `executed`'s failure above, and the same reason.
        log.warn(settled.reason);
        forgetIfGone(settled.problem, connection.profileId);
        outputChannel.writeFailure(settled.problem);
        resultPanel.writeFailure(settled.problem);
      } else {
        // `traceback` (from `drainOutputs`) lets the channel skip re-echoing a
        // structured traceback's message that already streamed live into it —
        // Finding 74, Phase 5d-iii. Only the output channel takes this: it is
        // the terminal-style transcript where the raw traceback text already
        // scrolled past. The result panel's redundancy (if any) is a separate
        // question, out of 5d-iii's scope.
        outputChannel.writeOutcome(settled.value, traceback);
        resultPanel.writeOutcome(settled.value);
        // Phase 4d: a run that raised, with a structured traceback to
        // position it by, gets one Problems-panel entry at the innermost
        // user frame. `diagnostics.publish` is a no-op when no frame maps
        // (a SAS-side error, or an all-library stack) — see its own doc.
        // The message is the outcome's own diagnostic text, which already
        // carries 4c's `ModuleNotFoundError` → Show Environment pointer;
        // `?? traceback.message` is belt-and-braces — `buildFailureOutcome`
        // only ever emits the traceback output together with exactly one
        // diagnostic, so `diagnostics[0]` is present whenever `traceback` is.
        if (!settled.value.succeeded && traceback !== undefined) {
          diagnostics.publish(
            program.origin,
            traceback,
            settled.value.diagnostics[0]?.message ?? traceback.message,
          );
        }
      }
    } finally {
      currentRun = undefined;
      syncRunningContext(false);
    }
  };

  const cancelRun = async (): Promise<void> => {
    if (currentRun !== undefined) {
      // Finding 75 (Phase 4b): the server-side half of a cancel can fail —
      // measured live, a missing or already-stale ETag answers `428` — and
      // this used to be discarded unread. The *local* run still stops
      // regardless (`handle.done` settles from `LogStream`'s own abort, not
      // from this reply — see `cancelJob`'s own doc comment), so a failure
      // here does not mean the program kept running locally; it means the
      // request that was supposed to tell Viya to stop it did not land, and
      // per Finding 76, the SAS session may keep executing the cancelled
      // program for up to its own natural duration regardless of whether
      // this succeeds. Logged and surfaced, not silently dropped.
      const cancelled = await currentRun.backend.cancel(currentRun.handle);
      if (!cancelled.ok) {
        log.warn(cancelled.reason);
        reportProblem(cancelled.problem);
      }
      return;
    }
    // No `execute()` handle in flight, but a `reset()` might be — it
    // produces none, so the only way the seam lets a caller interrupt one is
    // `close()`, which cancels whatever is running and then disconnects.
    // `backendFor()` always re-marks a reused backend connected first, which
    // is what makes closing it here safe for whatever this window asks for
    // next.
    //
    // `currentReset` names the exact backend a reset is running on, tracked
    // by `resetPythonState` for the duration of its own call — not
    // re-derived from the *currently active* profile at cancel time. An
    // earlier version of this scoped the fallback to `targets.status()`'s
    // profile instead, which fixed the previous "close whichever cached
    // backend is busy" bug but broke as soon as the run target or active
    // profile changed while the reset was still going: the fallback would
    // then look at the wrong profile, or none, and report nothing running
    // while the reset kept going regardless. Codex's review on this PR.
    if (currentReset !== undefined) {
      await currentReset.backend.close();
      return;
    }
    inform(vscode.l10n.t("Nothing is running."));
  };

  const resetPythonState = async (): Promise<void> => {
    const readiness = targets.readiness();
    if (!readiness.ok) {
      reportNotReady(readiness.reason);
      return;
    }

    const built = await backendFor();
    if (built === undefined) return;
    const { backend, connection } = built;

    // See `runNow`'s matching comment: the message here is redundant with
    // `reset()`'s own `busy` refusal below, but the check itself is what
    // stops a second `Reset Python State` fired while one is already running
    // from reaching `currentReset` and this function's `finally` — which
    // would otherwise clear the *first*, still-running reset's tracking out
    // from under it.
    if (backend.busy) {
      reportProblem({ code: "busy", running: "a run in this window" });
      return;
    }

    syncRunningContext(true);
    outputChannel.reveal();
    outputChannel.writeResetHeader(connection.profileName);
    currentReset = { backend };
    try {
      // Window, not Notification: this one is not cancellable (a reset has
      // no handle of its own — see `cancelRun`'s comment), so there is no
      // button whose absence would be misleading.
      const result = await showProgress(
        vscode.ProgressLocation.Window,
        vscode.l10n.t("Resetting the Python interpreter…"),
        false,
        async () => await backend.reset(),
      );
      if (!result.ok) {
        // Same fix as `runNow`'s two failure sites above, and the same
        // reason (Phase 3's 3f slice, 2026-08-28).
        log.warn(result.reason);
        forgetIfGone(result.problem, connection.profileId);
        outputChannel.writeFailure(result.problem);
      } else {
        outputChannel.writeResetSucceeded();
      }
    } finally {
      currentReset = undefined;
      syncRunningContext(false);
    }
  };

  /** Opens (creating if necessary) the environment document for the current
   * connection. Not `async` on the caller's behalf beyond what
   * `vscode.workspace.openTextDocument` itself awaits — this is the one place
   * `showEnvironment`/`refreshEnvironment` share, so a fix to how the
   * document is opened only has one call site to make it in. */
  const openEnvironmentDocument = async (
    profileId: string,
    profileName: string,
  ): Promise<void> => {
    const document = await vscode.workspace.openTextDocument(
      environmentDocumentUri(profileId, profileName),
    );
    await vscode.window.showTextDocument(document, { preview: false });
  };

  /**
   * `showEnvironment`/`refreshEnvironment`'s shared body.
   *
   * `forceProbe` is the only difference between the two commands: `false`
   * opens a cached answer straight away with no network call at all, and
   * `true` always re-probes first — `PRODUCTION_PLAN.md` §2.3's "a slow
   * answer that changes rarely" is exactly why the cheap path exists, and its
   * own "explicit refresh" is exactly why the expensive one has to be
   * reachable on demand rather than only the first time.
   *
   * No `pythonOnViya.running`/Cancel wiring, unlike `runNow`/`resetPythonState`:
   * a probe shares their `busy`/serial contract (`ProcPythonBackend.probeRuntime`
   * calls the same `SubmissionGuard`), so it still correctly refuses to
   * overlap a run or a reset, but this project's Cancel command has nothing
   * to interrupt it with — the same reason `resetPythonState`'s own progress
   * is `ProgressLocation.Window`, not `Notification`, below.
   */
  const showEnvironmentImpl = async (forceProbe: boolean): Promise<void> => {
    const readiness = targets.readiness();
    if (!readiness.ok) {
      reportNotReady(readiness.reason);
      return;
    }

    // Checked from `profiles.get()` — never `backendFor()` — so that a cache
    // hit really does cost nothing: `backendFor()` calls `sessions.connect()`,
    // which for a profile this window has no live session for yet means a
    // real network round trip (and possibly an interactive auth prompt), not
    // the no-op this function's own doc comment promises for the cache-hit
    // case. Caught on adversarial review of this slice's first draft, which
    // connected unconditionally before ever consulting the cache.
    if (!forceProbe) {
      const profile = profiles.get(readiness.profileName);
      if (profile !== undefined && environment.get(profile.id) !== undefined) {
        await openEnvironmentDocument(profile.id, readiness.profileName);
        return;
      }
    }

    const built = await backendFor();
    if (built === undefined) return;
    const { backend, connection } = built;

    if (backend.busy) {
      reportProblem({ code: "busy", running: "a run in this window" });
      return;
    }

    const probed = await showProgress(
      vscode.ProgressLocation.Window,
      vscode.l10n.t("Checking the Python environment on SAS Viya…"),
      false,
      async () => await backend.probeRuntime(),
    );
    if (!probed.ok) {
      // `localiseBackendProblem`'s `runtime-unavailable`/`backend-failed` arms
      // both end "See the Python on Viya log for details" — but the only
      // deployment-specific sentence a failed probe carries (the `SYSERRORTEXT`
      // behind `runtime-unavailable`, e.g. "PROC PYTHON is not licensed on this
      // deployment") lives on `probed.reason`, which nothing else on this path
      // writes anywhere. Log it so that instruction is true.
      log.warn(probed.reason);
      forgetIfGone(probed.problem, connection.profileId);
      reportProblem(probed.problem);
      return;
    }

    await environment.set(connection.profileId, probed.value);
    // Makes an already-open tab for this profile pick up the fresh answer —
    // a no-op if nothing has it open. `openEnvironmentDocument` below always
    // renders live from `environment.get()` regardless, so this is only for
    // the tab that is already showing the stale content right now.
    environmentDocuments.refresh(connection.profileId, connection.profileName);
    await openEnvironmentDocument(connection.profileId, connection.profileName);
  };

  const selectRunTarget = async (): Promise<void> => {
    const entries = runTargetPickEntries(profiles.names(), targets.status());
    // Conditional spreads, not `description: maybeUndefined` — the same
    // reason `profile/commands.ts`'s `askValidated` builds its options this
    // way: `exactOptionalPropertyTypes` treats an explicit `undefined` as a
    // different thing from an absent key, and `vscode.QuickPickItem`'s
    // optional fields want the key absent, not present and empty.
    const items = entries.map((entry) => {
      const endpoint =
        entry.kind === "viya" && entry.profileName !== undefined
          ? profiles.get(entry.profileName)?.endpoint
          : undefined;
      return {
        label:
          entry.kind === "local"
            ? `$(vm-outline) ${vscode.l10n.t("Local Python")}`
            : `$(server) ${entry.profileName ?? ""}`,
        ...(endpoint === undefined ? {} : { description: endpoint }),
        ...(entry.current ? { detail: vscode.l10n.t("Currently in use") } : {}),
        entry,
      };
    });

    const picked = await pick(items, {
      title: vscode.l10n.t("Select Run Target"),
      placeHolder: vscode.l10n.t("Where should Python code run?"),
    });
    if (picked === undefined) return;

    if (picked.entry.kind === "local") {
      await targets.setKind("local");
      return;
    }
    if (picked.entry.profileName !== undefined) {
      await profiles.setActiveName(picked.entry.profileName);
    }
    await targets.setKind("viya");
  };

  return {
    outputChannel,
    resultPanel,
    diagnostics,
    environmentDocuments,
    runFile: () => runNow(true),
    runSelection: () => runNow(false),
    cancelRun,
    resetPythonState,
    selectRunTarget,
    showEnvironment: () => showEnvironmentImpl(false),
    refreshEnvironment: () => showEnvironmentImpl(true),
    dispose: () => {
      targetChangeSubscription.dispose();
      if (deps.outputChannel === undefined) outputChannel.dispose();
      if (deps.resultPanel === undefined) resultPanel.dispose();
      if (deps.diagnostics === undefined) diagnostics.dispose();
      if (deps.environmentDocuments === undefined) {
        environmentDocuments.dispose();
      }
      // Unlike `ComputeSessionManager.dispose()` — which has nothing worth
      // tearing down server-side, and says so — a busy `ProcPythonBackend`
      // has a real interrupt `close()` can send. Fired, not awaited: this
      // method is synchronous, the window is closing regardless, and there
      // is nowhere to await it that VS Code would honour, the same
      // reasoning `ComputeSessionManager.dispose()` gives for not joining
      // an in-flight `connect()`. If the interrupt never lands before the
      // process exits, the SAS-side run keeps executing to its own
      // conclusion, unwatched rather than orphaned — this window has simply
      // stopped being the one that cares. Safe to call on every cached
      // backend regardless of whether it is actually busy: past the cancel
      // branch, `close()`'s own contract is a no-op. Raised on review.
      for (const cached of backends.values()) {
        void cached.backend.close();
      }
    },
  };
}

export function registerRunCommands(
  context: vscode.ExtensionContext,
  sessions: RunCommandSessions,
  profiles: RunCommandProfiles,
  targets: RunTargetStore,
  environment: RunCommandEnvironment,
  log: vscode.LogOutputChannel,
  deps: RunCommandDeps = {},
): void {
  const handlers = createRunCommandHandlers(
    sessions,
    profiles,
    targets,
    environment,
    log,
    context.extensionUri,
    deps,
  );

  context.subscriptions.push(
    handlers,
    vscode.commands.registerCommand("pythonOnViya.selectRunTarget", () =>
      handlers.selectRunTarget(),
    ),
    vscode.commands.registerCommand("pythonOnViya.runFile", () =>
      handlers.runFile(),
    ),
    vscode.commands.registerCommand("pythonOnViya.runSelection", () =>
      handlers.runSelection(),
    ),
    vscode.commands.registerCommand("pythonOnViya.cancelRun", () =>
      handlers.cancelRun(),
    ),
    vscode.commands.registerCommand("pythonOnViya.resetPythonState", () =>
      handlers.resetPythonState(),
    ),
    vscode.commands.registerCommand("pythonOnViya.showEnvironment", () =>
      handlers.showEnvironment(),
    ),
    vscode.commands.registerCommand("pythonOnViya.refreshEnvironment", () =>
      handlers.refreshEnvironment(),
    ),
    // The one `TextDocumentContentProvider` this extension registers —
    // `createRunCommandHandlers` only constructs it (see this module's own
    // doc comment on why registration itself belongs here, not there).
    vscode.workspace.registerTextDocumentContentProvider(
      ENVIRONMENT_SCHEME,
      handlers.environmentDocuments,
    ),
  );

  log.debug("registered the run commands");
}

/** Streams a handle's outputs into the channel and the result panel until it
 * ends. Separate function so `runNow`'s `withProgress` callback reads as
 * "drain, then wait for the outcome" rather than a loop buried inside a
 * bigger one.
 *
 * Returns the structured {@link Traceback} the run streamed, if any —
 * `procPython.ts` pushes exactly one, as its trailing `RichOutput`, before
 * `handle.done` settles (last-writer-wins here regardless). `runNow` needs it
 * for the Problems panel (Phase 4d); the channel and panel have already
 * rendered it by the time this returns. */
async function drainOutputs(
  handle: ExecutionHandle,
  outputChannel: RunOutputChannel,
  resultPanel: ResultPanel,
): Promise<Traceback | undefined> {
  let traceback: Traceback | undefined;
  for await (const output of handle.outputs) {
    if (output.mime === "application/vnd.python.traceback") {
      traceback = output.data;
    }
    outputChannel.writeOutput(output);
    resultPanel.writeOutput(output);
  }
  return traceback;
}
