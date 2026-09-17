// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Slice 3d-i's commands: `selectRunTarget`, `Run File`, `Run Selection`,
 * `Cancel`, `Reset Python state`.
 *
 * The one-backend-per-profile cache this module built for itself in 3d-i —
 * one `ProcPythonBackend` per profile, reused across runs for as long as the
 * underlying `ComputeConnection` object is the same one `ComputeSessionManager`
 * hands back, with a reconnect (a new session, a new dialect resolution)
 * getting a fresh backend rather than one carrying the old session's
 * fileref/run counters — moved to `./backendCache` in Phase 9's 9b slice, so a
 * `NotebookController` could share it instead of duplicating it. This module
 * still owns *when* it is consulted (`backendCache.backendFor()`, called from
 * `runNow`/`resetPythonState`/`showEnvironmentImpl`), just no longer the cache
 * itself; see `./backendCache`'s own doc comment for the full reasoning.
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

import type {
  ExecutionHandle,
  Program,
  PythonPackage,
  Traceback,
} from "../backend/backend";
import { localiseBackendProblem } from "../backend/messages";
import type { BackendProblem } from "../backend/problems";
import type { ProcPythonBackend } from "../backend/procPython";
import type { ComputeSessionManager } from "../compute/sessionManager";
import type { ProfileStore } from "../profile/store";
import { createBackendCache, type BackendCache } from "./backendCache";
import { RunDiagnostics } from "./diagnostics";
import { diffEnvironments } from "./environmentDiff";
import {
  ENVIRONMENT_SCHEME,
  environmentDocumentUri,
  EnvironmentDocumentProvider,
} from "./environmentPanel";
import type { EnvironmentStore } from "./environmentStore";
import { readActiveLocalEnvironment } from "./localPythonEnvironment";
import { RunOutputChannel } from "./outputChannel";
import {
  syncPylanceStubs,
  type PylanceStubSyncResult,
} from "./pylanceStubSync";
import { ResultPanel } from "./resultPanel";
import type { StubbablePackage } from "./stubGenerator";
import {
  describeStubSyncOutcome,
  selectPackagesToStub,
  type StubSyncOutcome,
} from "./stubSyncPlan";
import { runTargetPickEntries } from "./target";
import type { RunTargetStore } from "./targetStore";

/** Gates `editor/title/run` and `editor/context` (ADR-0011). */
export const RUN_TARGET_CONTEXT_KEY = "pythonOnViya.runTarget";
/** Gates the Cancel command's `enablement`. */
export const RUNNING_CONTEXT_KEY = "pythonOnViya.running";
/** VS Code's own built-in reload command — what the reload-advisable
 * notice's action button runs (10b). */
const RELOAD_WINDOW_COMMAND = "workbench.action.reloadWindow";
/** The Python extension's own language-server-only restart, offered ahead of
 * a full window reload for the same stub-tree change (10b design revision,
 * `phase-10.md`'s "Proposed design change, 2026-09-15" and Finding 10.4) —
 * confirmed against a real installed `ms-python.python` 2026.4.0's own
 * `package.json` `contributes.commands`, not assumed from an issue report's
 * title. */
const RESTART_LANGUAGE_SERVER_COMMAND = "python.analysis.restartLanguageServer";

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
  /** Defaults to `vscode.env.clipboard.writeText`. `searchEnvironment` (10a)
   * is this module's only caller — injectable for the same reason every
   * other real `vscode` call here is: a test should not depend on a real
   * system clipboard being available (the integration test host's CI leg
   * runs headless). */
  writeClipboardText?: ((text: string) => Thenable<void>) | undefined;
  /** Defaults to `./pylanceStubSync`'s `syncPylanceStubs`. 10b: called once
   * per fresh probe (never on a cache hit) from `ensureProbedEnvironment`,
   * so a test can substitute a fake without touching a real workspace's
   * filesystem or `settings.json` — the same reason every other real
   * `vscode` call in this module is injectable. */
  pylanceStubs?:
    | ((
        packages: readonly StubbablePackage[],
      ) => Promise<PylanceStubSyncResult>)
    | undefined;
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
  /** Defaults to a fresh `BackendCache` (`./backendCache`) over `sessions`.
   * Supplying one hands its lifecycle to the caller — same rule as
   * `outputChannel`/`resultPanel` above — and is how a `NotebookController`
   * shares one cached backend per profile with Run File, rather than each
   * holding an independent one. `extension.ts` is the one real caller that
   * does this; see `docs/phases/phase-9.md`'s Plan section, "What needs real
   * design work, not a port", for why the sharing matters. */
  backendCache?: BackendCache | undefined;
  /** Defaults to `vscode.workspace.onDidCloseTextDocument`. Phase 5d-iv: a
   * closed document's Problems entry (`src/run/diagnostics.ts`) is cleared
   * here. Injectable so an integration test fires it synchronously rather
   * than closing a real editor. */
  onDidCloseTextDocument?: vscode.Event<vscode.TextDocument> | undefined;
  /** Phase 5d-iv: fires when a profile signs out, at which point the whole
   * Problems collection is cleared. `clearAll`, not a per-profile delete,
   * because an entry carries no record of which profile's run produced it —
   * there is nothing finer to clear. Supplied by `extension.ts` as
   * `ViyaAuthenticationProvider.onDidSignOut`, which fires only on a
   * deliberate sign-out (palette command or Accounts menu), never on
   * `onDidChangeSessions`'s diff — that also drops a profile a slow renewal
   * missed for one poll. Absent in tests that do not exercise sign-out; no
   * default, there is no `vscode` namespace event for it. */
  onDidSignOut?: vscode.Event<void> | undefined;
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
  /** 10a's `Python on Viya: Search environment` — a filterable `QuickPick`
   * over the current profile's cached packages, additive to {@link
   * showEnvironment}'s own document rather than a replacement for it. Never
   * force-probes, the same cache-first default `showEnvironment` itself
   * uses when not asked to refresh. */
  searchEnvironment(): Promise<void>;
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
  const backendCache = deps.backendCache ?? createBackendCache(sessions, log);
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
  const targetChangeSubscription = targets.onDidChange(() => {
    syncTargetContext();
    // Phase 5d-iv: a Problems entry is only ever published for a Viya run, and
    // once the target is Local nothing can re-run the file to clear one — so a
    // flip to Local clears the whole collection here rather than leaving stale
    // entries behind. A viya→viya profile switch fires this too and is
    // deliberately left alone: a run against the new profile could still be
    // about the same code.
    if (targets.kind() === "local") diagnostics.clearAll();
  });
  syncTargetContext();
  syncRunningContext(false);

  // Phase 5d-iv: the two lifecycle events besides a target flip that leave a
  // Viya-run diagnostic with no next run of its file to clear it. `commands.ts`
  // owns the "when to clear"; `RunDiagnostics` owns the "how".
  const onDidCloseTextDocument =
    deps.onDidCloseTextDocument ?? vscode.workspace.onDidCloseTextDocument;
  const documentCloseSubscription = onDidCloseTextDocument((document) => {
    // `onDidCloseTextDocument` also fires when a document's language id
    // changes (VS Code's own API note), not only on a real close — so a file
    // switched out of Python mode clears its entry too. That is fine: it is
    // no longer a Python file, and a stale Viya-run marker on it would only
    // mislead. `clearFor` on a URI with no entry is a documented safe no-op,
    // so this needs no languageId/scheme filter either way.
    diagnostics.clearFor(document.uri);
  });
  const signOutSubscription = deps.onDidSignOut?.(() => {
    diagnostics.clearAll();
  });

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

    const built = await backendCache.backendFor();
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
      // at the point a run actually begins — not before
      // `backendCache.backendFor()`, where a connect failure or a `busy`
      // refusal would clear Problems while the output channel and result
      // panel still showed the previous run. A run that now passes, or fails
      // before producing a traceback, leaves nothing stale; keyed on the
      // origin URI, the key `publish` sets.
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
        // `traceback` (from `drainOutputs`) lets both surfaces skip re-echoing,
        // under the outcome line, an exception message that already reached
        // them as the raw streamed traceback — Finding 74, Phase 5d-iii. The
        // channel had it once (as text); the panel had it twice (raw text plus
        // the structured, clickable item), so this matters more there.
        outputChannel.writeOutcome(settled.value, traceback);
        resultPanel.writeOutcome(settled.value, traceback);
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
    // `backendCache.backendFor()` always re-marks a reused backend connected
    // first, which is what makes closing it here safe for whatever this
    // window asks for next.
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

    const built = await backendCache.backendFor();
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
   * `showEnvironment`/`refreshEnvironment`/`searchEnvironment` (10a)'s
   * shared body: ensures a probed environment is available for the current
   * connection, probing once if `forceProbe` or nothing is cached yet, and
   * hands back its packages. `undefined` means nothing could be shown — not
   * ready, busy, or the probe itself failed — and every one of those paths
   * has already reported itself to the user by the time this returns.
   *
   * `forceProbe` is the only difference `showEnvironment`/`refreshEnvironment`
   * see between themselves: `false` opens a cached answer straight away with
   * no network call at all, and `true` always re-probes first —
   * `PRODUCTION_PLAN.md` §2.3's "a slow answer that changes rarely" is
   * exactly why the cheap path exists, and its own "explicit refresh" is
   * exactly why the expensive one has to be reachable on demand rather than
   * only the first time. `searchEnvironment` always passes `false` — a quick
   * lookup has no business forcing a probe `showEnvironment` itself would
   * not force.
   *
   * No `pythonOnViya.running`/Cancel wiring, unlike `runNow`/`resetPythonState`:
   * a probe shares their `busy`/serial contract (`ProcPythonBackend.probeRuntime`
   * calls the same `SubmissionGuard`), so it still correctly refuses to
   * overlap a run or a reset, but this project's Cancel command has nothing
   * to interrupt it with — the same reason `resetPythonState`'s own progress
   * is `ProgressLocation.Window`, not `Notification`, below.
   */
  /**
   * 10b: after a genuinely fresh probe (never on a cache hit — a cache hit
   * means nothing about the remote package set could have changed), syncs
   * the Pylance stub tree and reports whether a window reload is worth
   * telling the user about. Which packages get stubbed (`diff.remoteOnly`,
   * or every remote package when the local environment itself is unknown —
   * Finding 10.2, `phase-10.md`'s Probe findings) and what a completed sync
   * means for the caller (reload notice? log line? both?) are
   * `./stubSyncPlan.ts`'s own pure decisions — see that module's doc
   * comment for why they live there rather than inline here: this file
   * imports `vscode` and is excluded from the unit coverage tier
   * altogether, and those decisions need no live backend probe to test on
   * their own.
   */
  // Set once a stub-path-conflict notice has actually been shown for a given
  // conflicting value, so a stable conflict (the user has deliberately
  // pointed `stubPath` elsewhere) is not re-announced on every "Refresh
  // Environment Info" forever — only the first time this window sees it, or
  // again if the conflicting value itself changes. Adversarial review,
  // before this PR's push: the notice previously fired unconditionally on
  // every fresh probe that hit the conflict outcome.
  let lastInformedStubPathConflict: string | undefined;

  const syncStubsForFreshProbe = async (
    remote: readonly PythonPackage[],
  ): Promise<boolean> => {
    // The whole sync — including `readActiveLocalEnvironment` and
    // `deps.pylanceStubs`, an injectable seam a future caller could make
    // throw — runs ahead of `environment.set` in `ensureProbedEnvironment`,
    // on the same probe result's critical path. This is a side feature; it
    // must degrade to "no stub sync happened" rather than lose an
    // already-successful probe. Adversarial review, before this PR's push.
    try {
      const local = await readActiveLocalEnvironment();
      const diff = diffEnvironments(
        remote,
        local.kind === "known" ? local.packages : undefined,
      );
      const localTopLevelNames =
        local.kind === "known" ? local.topLevelNames : [];

      const { toStub, missing } = selectPackagesToStub(
        remote,
        diff,
        localTopLevelNames,
      );
      for (const name of missing) {
        log.warn(
          `Pylance stub sync (10b): "${name}" was in the remote-only diff but not found in this profile's own package list; skipped.`,
        );
      }

      const sync = deps.pylanceStubs ?? syncPylanceStubs;
      const outcome: StubSyncOutcome = await sync(toStub);
      const report = describeStubSyncOutcome(outcome);
      if (report.logWarning !== undefined) log.warn(report.logWarning);
      if (report.conflictValue === undefined) {
        // The conflict is gone (the setting was unset, or this sync's own
        // `stubPath` write finally succeeded) — re-arm the notice. Without
        // this, a conflict that clears and later *recurs* with the exact
        // same value would stay silently suppressed forever: a PR #182
        // review round found the original version never reset this field at
        // all, so "same value as last time" and "same value, reintroduced
        // after being resolved" were indistinguishable.
        lastInformedStubPathConflict = undefined;
      } else if (report.conflictValue !== lastInformedStubPathConflict) {
        lastInformedStubPathConflict = report.conflictValue;
        // "Skipped generating", not "generated but left untouched": a PR
        // #182 review round found a conflict must stop `syncPylanceStubs`
        // before it ever writes the stub tree (see that module's own
        // "decide before writing" doc comment) — so nothing at
        // `STUB_TREE_RELATIVE_PATH` was written this time, and the previous
        // wording (from an earlier round, when generation genuinely was
        // unconditional) would now be false.
        inform(
          vscode.l10n.t(
            'Skipped generating Pylance stubs: python.analysis.stubPath is already set to "{0}" in this workspace.',
            report.conflictValue,
          ),
        );
      }
      return report.reloadAdvisable;
    } catch (error) {
      log.warn(
        `Pylance stub sync (10b): the sync itself failed unexpectedly (${String(error)}); the probe result is unaffected.`,
      );
      return false;
    }
  };

  const informReloadAdvisable = (): void => {
    // 10b, Finding 10.1: a running Pylance never picks up a stub-tree change
    // on its own — this only ever runs after a fresh, non-cache-hit probe
    // that `stubSyncPlan.ts`'s `describeStubSyncOutcome` says actually
    // changed the stub tree (never on a cache hit, never when nothing
    // needed stubbing, and never on a resync that reproduced exactly what
    // was already on disk).
    const message = vscode.l10n.t(
      "Updated the Pylance stub information for this profile. Try restarting the Python language server first — if diagnostics still don't reflect it, reload the window.",
    );
    // `deps.inform` bypasses this whole action-button path, not just the
    // real `showInformationMessage` call — a test double has no user who
    // could ever click the button, and every test in this suite runs inside
    // the one shared extension host process, where a real
    // `workbench.action.reloadWindow` would tear down the test run itself.
    // Adversarial review, pre-push (`feat/phase-10b-pylance-stub-reflection`):
    // added on top of the earlier review pass, which left this as prose-only.
    const show = deps.inform;
    if (show !== undefined) {
      show(message);
      return;
    }
    void offerReloadRemedy(message).catch((error: unknown) => {
      log.warn(
        `Pylance stub sync (10b): reload-remedy notice failed (${String(error)}).`,
      );
    });
  };

  /**
   * 10b design revision (`phase-10.md`'s "Proposed design change,
   * 2026-09-15", written up in response to the developer's standing
   * objection to the reload-only design): a full `workbench.action.reloadWindow`
   * tears down the whole extension host — every extension restarts, and this
   * project's own live Viya connection is among the casualties, ~60–90s in
   * the 2026-09-15 manual test session's own measurement. Pylance's own
   * troubleshooting docs recommend `Python: Restart Language Server` first
   * for any `python.analysis.*` change, `stubPath` included — it restarts
   * only the language-server process, not the whole host, so it has no
   * structural reason to touch this extension's own state or any other
   * extension's.
   *
   * Offered *alongside* "Reload Window", never in place of it: some
   * remote/SSH/dev-container reports say the restart command can fail or be
   * absent outright, and separately Finding 10.3's own open result is that a
   * genuine full reload didn't clear one real case — neither remedy is
   * guaranteed, so the fallback has to stay reachable from the same notice.
   *
   * `RESTART_LANGUAGE_SERVER_COMMAND`'s existence is checked live via
   * `vscode.commands.getCommands()` rather than assumed — the button is
   * omitted entirely when it is not registered (an old/absent Python
   * extension), which degrades to today's reload-only notice rather than
   * offering a button that cannot work. If the command *is* registered but
   * throws when run — the "real, not hypothetical" case the research above
   * found — the failure is caught and logged, and a second, narrower notice
   * offers the reload fallback rather than leaving the user with a dead end.
   */
  const offerReloadRemedy = async (message: string): Promise<void> => {
    const reloadAction = vscode.l10n.t("Reload Window");
    const restartAction = vscode.l10n.t("Restart Language Server");
    // `getCommands` itself failing (never observed, but not documented as
    // impossible either) degrades the same way an absent command does:
    // treat the restart option as unavailable rather than surfacing an
    // error for a capability probe the user never asked for directly.
    const registered = await vscode.commands.getCommands(true).then(
      (all) => all.includes(RESTART_LANGUAGE_SERVER_COMMAND),
      () => false,
    );
    const actions = registered ? [restartAction, reloadAction] : [reloadAction];
    const selected = await vscode.window.showInformationMessage(
      message,
      ...actions,
    );
    if (selected === reloadAction) {
      try {
        await vscode.commands.executeCommand(RELOAD_WINDOW_COMMAND);
      } catch (error) {
        log.warn(
          `Pylance stub sync (10b): "${RELOAD_WINDOW_COMMAND}" failed (${String(error)}).`,
        );
      }
      return;
    }
    if (selected !== restartAction) return;
    try {
      await vscode.commands.executeCommand(RESTART_LANGUAGE_SERVER_COMMAND);
    } catch (error) {
      log.warn(
        `Pylance stub sync (10b): "${RESTART_LANGUAGE_SERVER_COMMAND}" failed (${String(error)}); offering a window reload instead.`,
      );
      const fallbackSelected = await vscode.window.showInformationMessage(
        vscode.l10n.t(
          "Restarting the Python language server failed. Reload the window instead?",
        ),
        reloadAction,
      );
      if (fallbackSelected === reloadAction) {
        try {
          await vscode.commands.executeCommand(RELOAD_WINDOW_COMMAND);
        } catch (fallbackError) {
          log.warn(
            `Pylance stub sync (10b): "${RELOAD_WINDOW_COMMAND}" failed (${String(fallbackError)}).`,
          );
        }
      }
    }
  };

  const ensureProbedEnvironment = async (
    forceProbe: boolean,
  ): Promise<
    | {
        readonly profileId: string;
        readonly profileName: string;
        readonly packages: readonly PythonPackage[];
        /** 10b: true when this call's own fresh probe changed the Pylance
         * stub tree on disk — never true on a cache hit, since nothing
         * remote could have changed. `showEnvironmentImpl` and
         * `searchEnvironmentImpl` both use this to decide whether a "reload
         * the window" notice is worth showing (Finding 10.1: a running
         * Pylance never picks the change up on its own) — a probe
         * `searchEnvironment` itself triggered on a cache miss writes to
         * the workspace exactly like a `showEnvironment`-triggered one
         * does, so it owes the user the same notice, not silence. */
        readonly reloadAdvisable: boolean;
      }
    | undefined
  > => {
    const readiness = targets.readiness();
    if (!readiness.ok) {
      reportNotReady(readiness.reason);
      return undefined;
    }

    // Checked from `profiles.get()` — never `backendCache.backendFor()` — so
    // that a cache hit really does cost nothing: `backendFor()` calls
    // `sessions.connect()`, which for a profile this window has no live
    // session for yet means a real network round trip (and possibly an
    // interactive auth prompt), not the no-op this function's own doc comment
    // promises for the cache-hit case. Caught on adversarial review of this
    // slice's first draft, which connected unconditionally before ever
    // consulting the cache.
    if (!forceProbe) {
      const profile = profiles.get(readiness.profileName);
      if (profile !== undefined) {
        const cached = environment.get(profile.id);
        if (cached?.capabilities.kind === "available") {
          return {
            profileId: profile.id,
            profileName: readiness.profileName,
            packages: cached.capabilities.packages,
            reloadAdvisable: false,
          };
        }
      }
    }

    const built = await backendCache.backendFor();
    if (built === undefined) return undefined;
    const { backend, connection } = built;

    if (backend.busy) {
      reportProblem({ code: "busy", running: "a run in this window" });
      return undefined;
    }

    // 10b: the stub sync (a filesystem write plus a settings update) runs
    // inside this same progress scope, not after it — folded in on
    // adversarial review of this slice, which found the sync running
    // unbounded and outside any progress UI at all once probing itself had
    // finished, for what the docs' own figure names as "a few hundred"
    // packages in the local-unknown case.
    const { probed, reloadAdvisable } = await showProgress(
      vscode.ProgressLocation.Window,
      vscode.l10n.t("Checking the Python environment on SAS Viya…"),
      false,
      async () => {
        const probeResult = await backend.probeRuntime();
        if (!probeResult.ok || probeResult.value.kind !== "available") {
          return { probed: probeResult, reloadAdvisable: false };
        }
        const advisable = await syncStubsForFreshProbe(
          probeResult.value.packages,
        );
        return { probed: probeResult, reloadAdvisable: advisable };
      },
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
      return undefined;
    }

    await environment.set(connection.profileId, probed.value);
    // Makes an already-open tab for this profile pick up the fresh answer —
    // a no-op if nothing has it open. `openEnvironmentDocument` always
    // renders live from `environment.get()` regardless, so this is only for
    // the tab that is already showing the stale content right now.
    environmentDocuments.refresh(connection.profileId, connection.profileName);
    // `RuntimeCapabilities`'s type admits `"unprobed"` too, but a *successful*
    // `probeRuntime()` never produces it — `backend.ts`'s own doc on that
    // method says a probe result is `"available"` or a `BackendResult`
    // failure, never a successful `"unprobed"`. Belt-and-braces, matching
    // `environmentPanel.ts`'s own guard on the same union.
    if (probed.value.kind !== "available") return undefined;
    return {
      profileId: connection.profileId,
      profileName: connection.profileName,
      packages: probed.value.packages,
      reloadAdvisable,
    };
  };

  const showEnvironmentImpl = async (forceProbe: boolean): Promise<void> => {
    const result = await ensureProbedEnvironment(forceProbe);
    if (result === undefined) return;
    await openEnvironmentDocument(result.profileId, result.profileName);
    if (result.reloadAdvisable) informReloadAdvisable();
  };

  /**
   * `Python on Viya: Search environment` (10a) — a filterable `QuickPick`
   * over the current profile's installed packages, additive to `Show
   * environment`'s own plain-text document rather than a replacement for it:
   * `docs/phases/phase-10.md`'s Plan section keeps 3e's own reasons for that
   * document (editor-native search, split view, "a package list is a list")
   * for the "read the whole thing" case, and adds this command for "find one
   * package fast" instead of reopening that settled choice.
   */
  const searchEnvironmentImpl = async (): Promise<void> => {
    const result = await ensureProbedEnvironment(false);
    if (result === undefined) return;
    // A cache miss here probes exactly like `showEnvironment` would (10a's
    // own cache-first default), which since 10b can also write generated
    // stubs and edit workspace settings — this owes the user the same
    // reload notice `showEnvironmentImpl` gives for the identical sync,
    // not silence just because the command that triggered it was a quick
    // lookup rather than opening the document.
    if (result.reloadAdvisable) informReloadAdvisable();

    const items = [...result.packages]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pkg) => ({
        label: pkg.name,
        description: pkg.version,
        pkg,
      }));

    const picked = await pick(items, {
      title: vscode.l10n.t("Search Environment — {0}", result.profileName),
      placeHolder: vscode.l10n.t(
        "Filter the packages installed on this Viya profile",
      ),
      matchOnDescription: true,
    });
    if (picked === undefined) return;

    const writeClipboardText =
      deps.writeClipboardText ??
      ((text: string) => vscode.env.clipboard.writeText(text));
    await writeClipboardText(`${picked.pkg.name}==${picked.pkg.version}`);
    inform(
      vscode.l10n.t(
        "Copied {0}=={1} to the clipboard.",
        picked.pkg.name,
        picked.pkg.version,
      ),
    );
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
    searchEnvironment: searchEnvironmentImpl,
    dispose: () => {
      targetChangeSubscription.dispose();
      documentCloseSubscription.dispose();
      signOutSubscription?.dispose();
      if (deps.outputChannel === undefined) outputChannel.dispose();
      if (deps.resultPanel === undefined) resultPanel.dispose();
      if (deps.diagnostics === undefined) diagnostics.dispose();
      if (deps.environmentDocuments === undefined) {
        environmentDocuments.dispose();
      }
      // Same rule as every other field above: only dispose a cache this
      // constructor built for itself. `extension.ts` supplies its own shared
      // instance (`deps.backendCache`), which a notebook controller may still
      // be holding a reference to — closing every cached backend out from
      // under it here would be wrong in exactly the way disposing a
      // caller-supplied `outputChannel` would be. `./backendCache`'s own
      // `dispose()` doc comment has the reasoning for *why* closing every
      // cached backend, fired and not awaited, is the right thing when this
      // constructor does own the cache.
      if (deps.backendCache === undefined) backendCache.dispose();
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
    vscode.commands.registerCommand("pythonOnViya.searchEnvironment", () =>
      handlers.searchEnvironment(),
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
