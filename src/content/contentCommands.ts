// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The SAS Content tree's context-menu mutations — create a folder, create a
 * file, rename an item, delete an item. 6c-i.
 *
 * A thin `vscode` shell over `src/content/adapter.ts`, the same shape as
 * `src/content/contentFileSystem.ts`: it collects a name through an input box
 * (or a modal confirmation, for delete), calls the adapter, and turns a
 * {@link ContentProblem} into a notification via `localiseContentProblem` while
 * logging the technical sentence. Every real decision — which link to follow,
 * the `{name}`-vs-full-representation body shape (finding 6.7), the file-create
 * orphan rollback (finding 6.4), the `validateNewMemberName` / `validateRename`
 * pre-check (finding 6.6) — lives in the adapter and is unit-tested; this file
 * is registration and prompt glue.
 *
 * Each command runs only from a `view/item/context` entry whose `when` clause
 * (`package.json`) gates it on the `contextValue` `src/content/presentation.ts`
 * assigns, so the handler is always handed the tree's own {@link ContentItem}.
 * They are hidden from the command palette (`menus.commandPalette`,
 * `when: false`) because they cannot run without one.
 */

import * as vscode from "vscode";

import { type ContentAdapter } from "./adapter";
import { type ContentResult } from "./client";
import { localiseContentProblem } from "./messages";
import { describeContentProblem } from "./problems";
import { isContainer, sameResource, type ContentItem } from "./types";

/** What the command layer needs from its surroundings — supplied by
 * `src/content/contentExplorer.ts`, which owns the session and the tree. */
export interface ContentCommandDeps {
  /** The adapter for the active deployment, or `undefined` when signed out. */
  adapter: () => ContentAdapter | undefined;
  /** Reload the tree — passed the changed item's parent after a create so only
   * that folder re-fetches, or nothing after a rename/delete for a full
   * reload. */
  refresh: (item?: ContentItem) => void;
  /** Show and select a node in the tree (6c-iii). Best-effort — it resolves
   * whether or not `TreeView.reveal` could place the node. */
  reveal: (item: ContentItem) => Thenable<void>;
  /** The shared channel; the technical sentence for every failure goes here. */
  log: vscode.LogOutputChannel;
  /** The tree view id, for the progress spinner's location. */
  viewId: string;
}

/** Registers the four commands. Every disposable goes on `context.subscriptions`. */
export function registerContentCommands(
  context: vscode.ExtensionContext,
  deps: ContentCommandDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pythonOnViya.createContentFolder",
      (item?: ContentItem) => createChild(deps, item, "folder"),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.createContentFile",
      (item?: ContentItem) => createChild(deps, item, "file"),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.renameContentItem",
      (item?: ContentItem) => rename(deps, item),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.deleteContentItem",
      (item?: ContentItem) => remove(deps, item),
    ),
  );
}

async function createChild(
  deps: ContentCommandDeps,
  parent: ContentItem | undefined,
  kind: "folder" | "file",
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || parent === undefined) {
    reportNoTarget(adapter);
    return;
  }

  const name = await vscode.window.showInputBox({
    title:
      kind === "folder"
        ? vscode.l10n.t('New folder in "{0}"', parent.name)
        : vscode.l10n.t('New file in "{0}"', parent.name),
    prompt:
      kind === "folder"
        ? vscode.l10n.t("Name for the new folder")
        : vscode.l10n.t("Name for the new file, including its extension"),
    ...(kind === "file"
      ? { value: "untitled.py", valueSelection: [0, "untitled".length] }
      : {}),
    ignoreFocusOut: true,
    validateInput: validateName,
  });
  if (name === undefined) return;
  const chosen = name.trim();

  const { result, aborted } = await run(
    deps,
    parent,
    (signal) =>
      kind === "folder"
        ? adapter.createFolder(parent, chosen, signal)
        : adapter.createFile(parent, chosen, signal),
    kind === "folder"
      ? vscode.l10n.t('Creating folder "{0}"…', chosen)
      : vscode.l10n.t('Creating file "{0}"…', chosen),
  );

  if (result.ok && !aborted) {
    await revealCreated(deps, adapter, parent, result.value);
  }
}

/**
 * Show and select the item a create just landed. The create response is the new
 * resource's own representation (a folder id) or its member record (a member
 * id); the refreshed listing renders every child as a member record, so the
 * node the tree drew is found by {@link sameResource} — matching the underlying
 * resource address the two forms agree on — rather than by an id that will not.
 * If the re-listing fails, or nothing matches, the create response is revealed
 * as-is: worst case that only expands the parent.
 *
 * The re-list carries no `AbortSignal` and no spinner of its own — it runs
 * after `run`'s cancellable progress has resolved, is best-effort, and swallows
 * its own failure. It is still bounded by the client's default request timeout.
 */
async function revealCreated(
  deps: ContentCommandDeps,
  adapter: ContentAdapter,
  parent: ContentItem,
  created: ContentItem,
): Promise<void> {
  const listing = await adapter.getChildItems(parent);
  const node = listing.ok
    ? (sameResource(created, listing.value) ?? created)
    : created;
  await deps.reveal(node);
}

async function rename(
  deps: ContentCommandDeps,
  item: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || item === undefined) {
    reportNoTarget(adapter);
    return;
  }

  const name = await vscode.window.showInputBox({
    title: vscode.l10n.t('Rename "{0}"', item.name),
    value: item.name,
    valueSelection: renameSelection(item.name),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const local = validateName(value);
      if (local !== undefined) return local;
      return value.trim() === item.name
        ? vscode.l10n.t("That is already its name.")
        : undefined;
    },
  });
  if (name === undefined) return;
  const chosen = name.trim();
  if (chosen === item.name) return;

  await run(
    deps,
    undefined,
    (signal) => adapter.renameItem(item, chosen, signal),
    vscode.l10n.t('Renaming to "{0}"…', chosen),
  );
}

async function remove(
  deps: ContentCommandDeps,
  item: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || item === undefined) {
    reportNoTarget(adapter);
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    isContainer(item)
      ? vscode.l10n.t(
          'Delete the folder "{0}" and everything inside it?',
          item.name,
        )
      : vscode.l10n.t('Delete "{0}"?', item.name),
    {
      modal: true,
      detail: vscode.l10n.t("This cannot be undone from the editor."),
    },
    vscode.l10n.t("Delete"),
  );
  if (confirm === undefined) return;

  await run(
    deps,
    undefined,
    (signal) => adapter.deleteItem(item, signal),
    vscode.l10n.t('Deleting "{0}"…', item.name),
  );
}

/**
 * Run one adapter mutation behind the tree's progress spinner, cancellable, and
 * handle its outcome.
 *
 * Cancellation is the abort signal's job, not a post-hoc check of the progress
 * token: once `action` has resolved, its `ContentResult` is the truth. If the
 * user clicks **Cancel** *after* the mutation already landed, the work still
 * happened — so the tree is refreshed and (for a success) nothing else is said.
 * A `Cancel` *during* the request aborts it, and the adapter comes back with a
 * failure whose cause is that abort; that one stays silent. Every other failure
 * is logged and shown. The tree is reloaded whatever the outcome, because a
 * cancelled or failed multi-step delete may have changed the server partway.
 *
 * Returns the adapter's `ContentResult` and whether the work was aborted, so a
 * caller that wants to act on a success — `createChild` reveals what it made —
 * can, without re-deciding what "succeeded" means.
 */
async function run<T>(
  deps: ContentCommandDeps,
  refreshTarget: ContentItem | undefined,
  action: (signal: AbortSignal) => Promise<ContentResult<T>>,
  title: string,
): Promise<{ result: ContentResult<T>; aborted: boolean }> {
  const { result, aborted } = await vscode.window.withProgress(
    { location: { viewId: deps.viewId }, title, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => {
        controller.abort();
      });
      try {
        const value = await action(controller.signal);
        // Read synchronously, right after the await resolves — no yield point
        // for a late Cancel to slip through, so this reflects whether the work
        // itself was aborted, not whether the button was clicked afterwards.
        return { result: value, aborted: controller.signal.aborted };
      } finally {
        sub.dispose();
      }
    },
  );

  deps.refresh(refreshTarget);

  if (!result.ok && !aborted) {
    deps.log.error(
      vscode.l10n.t("SAS Content: {0}", describeContentProblem(result.problem)),
    );
    void vscode.window.showErrorMessage(localiseContentProblem(result.problem));
  }

  return { result, aborted };
}

/** Local, per-keystroke name checks — the authoritative one is the adapter's
 * server-side `validateNewMemberName` / `validateRename` call, which this does
 * not duplicate. */
function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return vscode.l10n.t("Enter a name.");
  if (trimmed === "." || trimmed === "..") {
    return vscode.l10n.t("Choose a different name.");
  }
  if (trimmed.includes("/")) {
    return vscode.l10n.t('A name cannot contain "/".');
  }
  return undefined;
}

/** Select the base name (before the last `.`) in the rename box, so retyping
 * keeps the extension. */
function renameSelection(name: string): [number, number] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [0, dot] : [0, name.length];
}

/** The signed-out / no-target message. `adapter === undefined` is the real
 * case (the view's welcome content usually pre-empts it); a missing `item`
 * would mean the command was invoked outside its menu, which the `when`
 * clauses prevent. */
function reportNoTarget(adapter: ContentAdapter | undefined): void {
  void vscode.window.showErrorMessage(
    adapter === undefined
      ? vscode.l10n.t("Sign in to SAS Viya to change SAS Content.")
      : vscode.l10n.t("Select an item in the SAS Content view first."),
  );
}
