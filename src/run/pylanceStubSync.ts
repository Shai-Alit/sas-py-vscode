// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Writes 10b's generated Pylance stub tree to disk and points
 * `python.analysis.stubPath` at it — the `vscode`-importing shell around
 * `./stubGenerator.ts` and `./stubPathSetting.ts`'s pure logic, the same
 * split `localPythonEnvironment.ts` draws around `./localPackages.ts`.
 *
 * ## Its own directory, never the conventional `typings/`
 *
 * A user can already have a hand-authored `typings/` directory Pylance reads
 * via `python.analysis.stubPath`'s own documented default (`./typings`) —
 * without ever setting the option explicitly. Pruning a stale entry out of a
 * directory this feature does not exclusively own risks deleting a user's
 * own content the moment their own top-level package name is not in this
 * refresh's desired set. So the generated tree lives at
 * {@link STUB_TREE_RELATIVE_PATH}, a project-namespaced directory nothing
 * else in a user's workspace has a reason to create — safe to fully own,
 * regenerate, and prune without asking what else might be sitting there.
 *
 * ## Never overwriting a `stubPath` someone else set
 *
 * See `./stubPathSetting.ts`'s own doc comment. This module reads the
 * setting's current **workspace-scoped** value via `inspect(...)` before
 * ever calling `.update(...)`, and only writes when
 * {@link decideStubPathAction} says it is safe to.
 *
 * ## Multi-root: the first workspace folder only
 *
 * A deliberate, modest scope limit for this first cut, not an oversight —
 * one Viya profile is connected per window regardless of how many folders
 * are open, and "which folder gets the generated stubs" has no obviously
 * correct multi-root answer this phase's own exit bar requires settling.
 *
 * ## Never shadowing the workspace's own source
 *
 * Finding 10.2's own scoping (`remoteOnly` only, never `localOnly`) stops a
 * generated stub from shadowing an *installed* package that already
 * resolves locally. It says nothing about a top-level name that is the
 * user's own workspace source and never was an installed distribution at
 * all — `tests`, `utils`, and similarly generic names turn up in real
 * `top_level.txt` listings often enough that the collision is not
 * hypothetical. `writeStubTree` below lists the (first) workspace folder's
 * own top-level directories and `.py` files and excludes any matching name
 * from the generated set (`stubGenerator.ts`'s own
 * `excludeWorkspaceOwnedNames`) before ever writing anything — Pyright
 * resolves `stubPath` *before* workspace source, so a generated stub with a
 * colliding name would otherwise win and silently disable real
 * type-checking for the user's own module.
 *
 * ## Only a local filesystem workspace
 *
 * `syncPylanceStubs` checks the (first) workspace folder's own URI scheme
 * before doing anything else. A virtual workspace (this extension's own
 * `sasContent:` `FileSystemProvider`, `vscode-vfs:`, or similar) has no
 * local disk for a generated stub tree to land on, and Pylance cannot read
 * one from there regardless — writing potentially hundreds of small files
 * over such a provider would cost real time and accomplish nothing.
 */

import * as vscode from "vscode";

import {
  excludeWorkspaceOwnedNames,
  generateStubTree,
  planStubTreeSync,
  type StubbablePackage,
} from "./stubGenerator";
import { decideStubPathAction } from "./stubPathSetting";

/** Relative to the (first) workspace folder's own root — the value handed to
 * `python.analysis.stubPath`, which itself resolves relative to the
 * workspace root regardless of which file `settings.json` lives in
 * (`microsoft/pylance-release#7178`, cited in `phase-10.md`'s Probe
 * findings). No leading `./`: `stubPath`'s own documented default
 * (`./typings`) uses one, but nothing in its resolution behaviour requires
 * it — a bare relative path is equivalent and simpler to build paths from. */
export const STUB_TREE_RELATIVE_PATH = ".pythonOnViya/typings";

const STUB_PATH_SETTING_SECTION = "python.analysis";
const STUB_PATH_SETTING_KEY = "stubPath";

export type PylanceStubSyncResult =
  /** `changed` is `true` only when applying the sync actually altered the
   * stub tree's top-level directory listing (`StubTreeSyncPlan.changed`,
   * `stubGenerator.ts`) — never on a resync that regenerated exactly what
   * was already on disk. `commands.ts` uses this, not `packages.length`, to
   * decide whether a fresh probe is worth a "reload the window" notice;
   * see `stubGenerator.ts`'s own doc comment on `StubTreeSyncPlan.changed`
   * for why the distinction matters. */
  | { readonly kind: "synced"; readonly changed: boolean }
  /** Nothing needed stubbing this time — the desired tree is empty. Any
   * previously-generated stubs are still pruned (a package that stops being
   * `remoteOnly` must not leave a stale stub behind), but `stubPath` itself
   * is left untouched: there is nothing useful to point it at, and setting
   * it for an empty directory would only be a needless write. */
  | { readonly kind: "nothing-to-stub" }
  /** No workspace folder is open — there is nowhere on disk to write a stub
   * tree, and no `settings.json` for a workspace-scoped `stubPath` to live
   * in. */
  | { readonly kind: "no-workspace" }
  /** The (first) workspace folder is not on the local filesystem — a
   * `sasContent:`/`vscode-vfs:`-shaped virtual folder, say. Nothing this
   * module writes there would be readable by Pylance either way, and
   * writing hundreds of small files over a network-backed
   * `FileSystemProvider` is not a cost worth paying to find that out. */
  | { readonly kind: "unsupported-workspace"; readonly scheme: string }
  /** `python.analysis.stubPath` is already set, at workspace scope, to
   * something other than {@link STUB_TREE_RELATIVE_PATH} — left untouched;
   * see `./stubPathSetting.ts`. */
  | { readonly kind: "stub-path-conflict"; readonly currentValue: string }
  /** Writing the stub files themselves, or the `stubPath` setting, failed —
   * a real filesystem error, or (per `WorkspaceConfiguration.update`'s own
   * documented throw conditions) a setting VS Code refused for a reason
   * this module does not attempt to distinguish further. `detail` is the
   * caught error's own message, so the caller's log line says more than
   * "it failed" — an `EACCES` or a read-only workspace used to be
   * undiagnosable from the log alone. Logged by the caller; never thrown
   * onward. */
  | { readonly kind: "write-failed"; readonly detail: string };

/** `true` for the one `readDirectory` failure this module treats as a
 * legitimate empty listing rather than a real error to surface: the root
 * (or, for the workspace root itself, a workspace that is somehow gone)
 * simply does not exist yet. Any other failure — permissions, a read-only
 * mount, anything else `vscode.workspace.fs` can throw — is rethrown, so it
 * reaches `syncPylanceStubs`'s own `try`/`catch` and comes back as
 * `"write-failed"` with a real cause, instead of being read as "nothing
 * here" and silently leaving stale stubs in place (the exact Finding 10.2
 * shadowing failure, reached by a different route: a permissions error on
 * the *listing* call, not on a write). */
function isMissingRoot(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError && error.code === "FileNotFound"
  );
}

interface RealFs {
  /** Direct child *directory* names — `vscode.workspace.fs.readDirectory`
   * returns files too, but only directories are ever meaningful entries
   * under a stub tree root. A root that does not exist yet (the very first
   * sync) reads back as `[]`; any other read failure is rethrown — see
   * {@link isMissingRoot}. */
  listTopLevelDirectories(uri: vscode.Uri): Promise<readonly string[]>;
  /** Top-level names at the *workspace* root (not the stub tree root) that a
   * generated stub must never shadow — every directory name, and every
   * `.py` file's name with the extension stripped (`six.py` shadows a
   * `six/` stub exactly as a `six/` package of the user's own would).
   * `stubGenerator.ts`'s own `excludeWorkspaceOwnedNames` is what actually
   * applies this list; see its doc comment for why it exists. Same
   * missing-root handling as {@link listTopLevelDirectories}. */
  listWorkspaceRootNames(uri: vscode.Uri): Promise<readonly string[]>;
  createDirectory(uri: vscode.Uri): Promise<void>;
  writeFile(uri: vscode.Uri, content: string): Promise<void>;
  /** Recursive, no trash — everything under the stub tree root is this
   * feature's own generated, deterministically-regenerable content, never
   * anything a user typed, so there is nothing a recycle bin round trip
   * would protect. */
  deleteRecursively(uri: vscode.Uri): Promise<void>;
}

const realFs: RealFs = {
  listTopLevelDirectories: async (uri) => {
    let entries: readonly (readonly [string, vscode.FileType])[];
    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch (error) {
      if (isMissingRoot(error)) return [];
      throw error;
    }
    return entries
      .filter(([, type]) => (type & vscode.FileType.Directory) !== 0)
      .map(([name]) => name);
  },
  listWorkspaceRootNames: async (uri) => {
    let entries: readonly (readonly [string, vscode.FileType])[];
    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch (error) {
      if (isMissingRoot(error)) return [];
      throw error;
    }
    const names: string[] = [];
    for (const [name, type] of entries) {
      if ((type & vscode.FileType.Directory) !== 0) {
        names.push(name);
      } else if ((type & vscode.FileType.File) !== 0 && name.endsWith(".py")) {
        names.push(name.slice(0, -".py".length));
      }
    }
    return names;
  },
  createDirectory: (uri) =>
    Promise.resolve(vscode.workspace.fs.createDirectory(uri)),
  writeFile: (uri, content) =>
    Promise.resolve(
      vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content)),
    ),
  deleteRecursively: (uri) =>
    Promise.resolve(
      vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false }),
    ),
};

/** Writes (or prunes) the stub tree at `stubRoot` for `packages`, excluding
 * any top-level name `workspaceRoot` already owns as real source
 * (`excludeWorkspaceOwnedNames`). Returns whether the tree's own top-level
 * listing actually changed — see `StubTreeSyncPlan.changed`'s doc comment
 * (`stubGenerator.ts`) for why that is not the same question as "was
 * anything written". */
async function writeStubTree(
  workspaceRoot: vscode.Uri,
  stubRoot: vscode.Uri,
  packages: readonly StubbablePackage[],
  fs: RealFs,
): Promise<boolean> {
  const generated = generateStubTree(packages);
  const workspaceNames = await fs.listWorkspaceRootNames(workspaceRoot);
  const desired = excludeWorkspaceOwnedNames(generated, workspaceNames);
  const existing = await fs.listTopLevelDirectories(stubRoot);
  const plan = planStubTreeSync(existing, desired);

  for (const name of plan.toDelete) {
    await fs.deleteRecursively(vscode.Uri.joinPath(stubRoot, name));
  }
  for (const file of plan.toWrite) {
    // Every generated path is exactly `<segment>/__init__.pyi`
    // (`stubGenerator.ts`'s own contract) — split on the one slash rather
    // than asking `vscode.Uri` to resolve a `..` segment for a directory
    // that is already known without it.
    const slashIndex = file.relativePath.indexOf("/");
    const dirName = file.relativePath.slice(0, slashIndex);
    const fileName = file.relativePath.slice(slashIndex + 1);
    const dirUri = vscode.Uri.joinPath(stubRoot, dirName);
    await fs.createDirectory(dirUri);
    await fs.writeFile(vscode.Uri.joinPath(dirUri, fileName), file.content);
  }
  return plan.changed;
}

/** `error instanceof Error ? error.message : String(error)` — the same
 * fallback shape used anywhere this codebase turns a caught `unknown` into a
 * log-worthy string. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Regenerates the stub tree for `packages` and, when safe
 * ({@link decideStubPathAction}), points `python.analysis.stubPath` at it.
 *
 * `packages` must already be filtered by the caller to only what 10a's diff
 * says is safe to stub — see `./stubGenerator.ts`'s own doc comment, "Why
 * only the caller's given list". This function trusts its input rather than
 * re-deriving the diff itself.
 */
export async function syncPylanceStubs(
  packages: readonly StubbablePackage[],
): Promise<PylanceStubSyncResult> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) return { kind: "no-workspace" };
  if (folder.uri.scheme !== "file") {
    return { kind: "unsupported-workspace", scheme: folder.uri.scheme };
  }

  const stubRoot = vscode.Uri.joinPath(folder.uri, STUB_TREE_RELATIVE_PATH);

  let changed: boolean;
  try {
    changed = await writeStubTree(folder.uri, stubRoot, packages, realFs);
  } catch (error) {
    return { kind: "write-failed", detail: describeError(error) };
  }

  // A `changed` write here means stale stubs from a previous sync were just
  // pruned (10a's diff no longer lists anything `remoteOnly`) — that still
  // needs to reach the caller as `"synced"` so a reload notice fires and
  // Pylance stops reading the now-deleted stub tree. Only report
  // `"nothing-to-stub"` when there was truly nothing to do.
  if (packages.length === 0 && !changed) return { kind: "nothing-to-stub" };

  try {
    const config = vscode.workspace.getConfiguration(
      STUB_PATH_SETTING_SECTION,
      folder.uri,
    );
    const inspected = config.inspect<string>(STUB_PATH_SETTING_KEY);
    const decision = decideStubPathAction(
      {
        globalValue: inspected?.globalValue,
        workspaceValue: inspected?.workspaceValue,
        workspaceFolderValue: inspected?.workspaceFolderValue,
      },
      STUB_TREE_RELATIVE_PATH,
    );
    if (decision.kind === "conflict") {
      return {
        kind: "stub-path-conflict",
        currentValue: decision.currentValue,
      };
    }
    if (decision.kind === "write") {
      await config.update(
        STUB_PATH_SETTING_KEY,
        STUB_TREE_RELATIVE_PATH,
        vscode.ConfigurationTarget.Workspace,
      );
      // Pointing `stubPath` at the tree for the first time is itself a
      // change worth a reload notice, even on the rare sync whose own file
      // set happened to already match what a previous, unrelated write left
      // on disk.
      changed = true;
    }
  } catch (error) {
    return { kind: "write-failed", detail: describeError(error) };
  }

  return { kind: "synced", changed };
}
