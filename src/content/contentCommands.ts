// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The SAS Content tree's context-menu mutations — create a folder, create a
 * file, rename an item, delete an item (6c-i); add an item to / remove it from
 * My Favorites (6d-i); restore a recycled item, empty the Recycle Bin (6d-ii);
 * cut an item, paste it into a folder (6e).
 *
 * ## Cut / Paste (6e) — an unambiguous alternative to drag-and-drop
 *
 * Right-click **Cut**, then right-click a folder and choose **Paste**. Both
 * reuse exactly what `src/content/contentDragAndDrop.ts`'s drop handler
 * calls — {@link moveObjection} to decide whether the move is valid,
 * `ContentAdapter.moveItem` to do it — so this is the same move, reached a
 * different way, not a second implementation to keep in sync. Added
 * alongside [ADR-0031](../../docs/adr/0031-content-folder-resource-uri.md)'s
 * drag-and-drop fix, but independently useful regardless of that fix: a drag
 * never tells the user whether a drop will move or copy, which this project's
 * own live testing found reason enough on its own — see
 * [ADR-0032](../../docs/adr/0032-content-cut-paste.md).
 *
 * Only one item can be cut at a time, held for the life of the extension
 * host and scoped to the deployment it was cut from — {@link ContentCommandDeps.activeEndpoint}
 * is recorded alongside it, since a `ContentAdapter` is per-endpoint and
 * reused across profile switches (the same fact 6d-i's `favoritesFolder()`
 * finding turned on); {@link paste} refuses a cut from one deployment
 * pasted after switching to another. `clearCutContentItem` is called on a
 * profile change and on sign-out (`contentExplorer.ts`) so a stale cut
 * cannot linger past either. There is no "cancel cut" command otherwise;
 * cutting a second item just replaces the first, and there is no visual
 * indication in the tree of what is currently cut (VS Code has no supported
 * way to dim/badge a single `TreeItem` on demand outside of a
 * `contextValue`-driven icon change, which would mean re-rendering the whole
 * tree just to grey one row — considered out of proportion for a first
 * slice).
 *
 * ## Delete became recycle (6d-ii)
 *
 * From 6d-ii, "Delete" on an ordinary folder or file member moves it to the
 * Recycle Bin — no confirmation, because Restore undoes it — matching the SAS
 * extension. A permanent delete (with a modal) happens only for an item that
 * *cannot* be recycled: a top-level folder read directly (no member record to
 * move) or one already sitting in the Recycle Bin. {@link isRecyclableMember}
 * is the split.
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
import { moveObjection, type MoveObjection } from "./contentMove";
import { localiseContentProblem } from "./messages";
import { describeContentProblem } from "./problems";
import {
  isContainer,
  isRecyclableMember,
  isRestorable,
  resourceHrefOf,
  sameResource,
  type ContentItem,
} from "./types";

/**
 * The item a Cut is pending for, and the deployment it was cut from — a
 * `ContentAdapter` is per-endpoint, reused across profile switches (the
 * same fact 6d-i's `favoritesFolder()` finding turned on), so a paste must
 * refuse to run a stale item's `self` link against a different deployment's
 * adapter. `undefined` means nothing is cut. See the file doc comment's
 * Cut/Paste section for why this is a single slot, not a list.
 */
let cutState:
  { readonly item: ContentItem; readonly endpoint: string } | undefined;

/** Sets (or clears) the pending cut and its context key together, so the two
 * can never drift apart. */
function setCutState(
  next: { readonly item: ContentItem; readonly endpoint: string } | undefined,
): void {
  cutState = next;
  void vscode.commands.executeCommand(
    "setContext",
    "pythonOnViya.hasCutContentItem",
    next !== undefined,
  );
}

/**
 * Clears a pending Cut, if any. Exported so `contentExplorer.ts` can call it
 * on a profile switch or sign-out — a cut item's endpoint check in
 * {@link paste} would already refuse a cross-endpoint paste, but a stale cut
 * surviving a sign-out with no way to clear it, or offering itself on a
 * profile it was never cut from, is confusing on its own; and so tests can
 * reset this module-level slot between cases.
 */
export function clearCutContentItem(): void {
  setCutState(undefined);
}

/** What the command layer needs from its surroundings — supplied by
 * `src/content/contentExplorer.ts`, which owns the session and the tree. */
export interface ContentCommandDeps {
  /** The adapter for the active deployment, or `undefined` when signed out. */
  adapter: () => ContentAdapter | undefined;
  /** The active deployment's own root, alongside {@link adapter} — recorded
   * against a Cut so {@link paste} can refuse one made against a since-changed
   * deployment, rather than running a stale item's link against the wrong
   * endpoint's adapter. */
  activeEndpoint: () => string | undefined;
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

/** Registers the ten commands. Every disposable goes on `context.subscriptions`. */
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
    vscode.commands.registerCommand(
      "pythonOnViya.addContentToFavorites",
      (item?: ContentItem) => favorite(deps, item, "add"),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.removeContentFromFavorites",
      (item?: ContentItem) => favorite(deps, item, "remove"),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.restoreContentItem",
      (item?: ContentItem) => restore(deps, item),
    ),
    vscode.commands.registerCommand("pythonOnViya.emptyRecycleBin", () =>
      emptyBin(deps),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.cutContentItem",
      (item?: ContentItem) => {
        cut(deps, item);
      },
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.pasteContentItem",
      (item?: ContentItem) => paste(deps, item),
    ),
  );
}

/**
 * "Cut" (6e). Records the item and the deployment it came from; nothing on
 * the server changes yet. The menu already hides this on a `.recycled` item
 * or anything that is not an ordinary member, but both are checked here too,
 * matching {@link favorite}'s own early-out — in case this ever runs some
 * other way than the menu.
 */
export function cut(
  deps: ContentCommandDeps,
  item: ContentItem | undefined,
): void {
  if (item?.inRecycleBin === true) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Restore this item from the Recycle Bin before moving it."),
    );
    return;
  }
  if (item !== undefined && item.type !== "child") {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('"{0}" cannot be moved from here.', item.name),
    );
    return;
  }

  const adapter = deps.adapter();
  const endpoint = deps.activeEndpoint();
  if (adapter === undefined || endpoint === undefined || item === undefined) {
    reportNoTarget(adapter);
    return;
  }

  setCutState({ item, endpoint });
  void vscode.window.showInformationMessage(
    vscode.l10n.t(
      'Cut "{0}". Right-click a folder and choose Paste.',
      item.name,
    ),
  );
}

/** The complete, standalone message for why {@link moveObjection} rejected a
 * paste — one full sentence per case, not a fragment interpolated into a
 * shared template, so each is independently translatable and can be
 * reordered by a locale that needs to. The drag-and-drop path stays silent
 * for most of these since a missed drag has no clear "the user meant this,"
 * but a deliberate Paste click deserves an explanation either way. */
function describeMoveObjection(
  reason: MoveObjection,
  item: ContentItem,
  target: ContentItem,
): string {
  switch (reason) {
    case "not-a-member":
      return vscode.l10n.t('"{0}" cannot be moved from here.', item.name);
    case "target-not-a-folder":
      return vscode.l10n.t(
        '"{0}" is not a folder you can move items into.',
        target.name,
      );
    case "in-recycle-bin":
      return vscode.l10n.t(
        "An item in the Recycle Bin can only be restored, not moved.",
      );
    case "into-itself":
      return vscode.l10n.t("You can't move a folder into itself.");
    case "already-there":
      return vscode.l10n.t(
        '"{0}" is already in "{1}".',
        item.name,
        target.name,
      );
  }
}

/**
 * "Paste" (6e). Moves {@link cutState}'s item into `target` via the exact
 * same `moveObjection` / `ContentAdapter.moveItem` pair
 * `contentDragAndDrop.ts`'s `handleDrop` calls — one implementation of "is
 * this move valid" and "how do you do it," reached two ways.
 *
 * The slot is cleared *before* the move runs, not after, and restored only
 * if the move did not actually happen (`!result.ok` — which already covers
 * a cancelled attempt, since `run` reports a cancelled action as a failure
 * whose cause is the abort). Clearing early rather than late closes two
 * related races a "clear on success" order leaves open: a second Paste
 * click fired while the first is still in flight now correctly sees
 * "nothing has been cut yet" instead of racing a second move of an item
 * that may already have relocated; and a move that lands right as the user
 * clicks Cancel (`result.ok && aborted` — a real, if narrow, window `run`'s
 * own doc comment describes) no longer leaves a now-invalid cut armed for a
 * second paste, because the slot was already gone before that race could
 * matter.
 */
export async function paste(
  deps: ContentCommandDeps,
  target: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || target === undefined) {
    reportNoTarget(adapter);
    return;
  }
  const pending = cutState;
  if (pending === undefined) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Nothing has been cut yet. Cut an item first."),
    );
    return;
  }
  if (pending.endpoint !== deps.activeEndpoint()) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        '"{0}" was cut from a different connection. Cut it again to paste it here.',
        pending.item.name,
      ),
    );
    return;
  }
  const item = pending.item;

  const objection = moveObjection(item, target);
  if (objection !== undefined) {
    void vscode.window.showWarningMessage(
      describeMoveObjection(objection, item, target),
    );
    return;
  }

  const destination = resourceHrefOf(target);
  if (destination === undefined) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('"{0}" has no address to move into.', target.name),
    );
    return;
  }

  clearCutContentItem();

  const { result, aborted } = await run(
    deps,
    undefined,
    (signal) => adapter.moveItem(item, destination, signal),
    vscode.l10n.t('Moving "{0}"…', item.name),
  );

  if (result.ok) {
    if (!aborted) await deps.reveal(result.value);
  } else {
    setCutState(pending);
  }
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
 * The re-list runs after `run`'s cancellable progress has resolved, so it has
 * no user-facing spinner and no progress token to thread; it is best-effort and
 * swallows its own failure. It is given its own short {@link REVEAL_RELIST_TIMEOUT_MS}
 * bound so a slow deployment cannot hold it open for the client's full default.
 */
async function revealCreated(
  deps: ContentCommandDeps,
  adapter: ContentAdapter,
  parent: ContentItem,
  created: ContentItem,
): Promise<void> {
  const listing = await adapter.getChildItems(
    parent,
    AbortSignal.timeout(REVEAL_RELIST_TIMEOUT_MS),
  );
  const node = listing.ok
    ? (sameResource(created, listing.value) ?? created)
    : created;
  await deps.reveal(node);
}

/** The bound on {@link revealCreated}'s follow-up listing — shorter than the
 * client's 15s default because it backs a best-effort reveal with no way for
 * the user to cancel it. */
const REVEAL_RELIST_TIMEOUT_MS = 8_000;

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

/**
 * "Delete" (6c-i, reworked in 6d-ii). An ordinary folder or file member is
 * **recycled** — moved to the Recycle Bin with no confirmation, because Restore
 * undoes it. Anything that cannot be recycled ({@link isRecyclableMember} is
 * `false`: a top-level folder read directly, or an item already in the bin) is
 * **permanently** deleted behind a modal.
 */
async function remove(
  deps: ContentCommandDeps,
  item: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || item === undefined) {
    reportNoTarget(adapter);
    return;
  }

  if (isRecyclableMember(item)) {
    await run(
      deps,
      undefined,
      (signal) => adapter.recycleItem(item, signal),
      vscode.l10n.t('Moving "{0}" to the Recycle Bin…', item.name),
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    isContainer(item)
      ? vscode.l10n.t(
          'Permanently delete the folder "{0}" and everything inside it?',
          item.name,
        )
      : vscode.l10n.t('Permanently delete "{0}"?', item.name),
    {
      modal: true,
      detail: vscode.l10n.t("This cannot be undone."),
    },
    vscode.l10n.t("Delete Permanently"),
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
 * "Restore" a recycled item to where it used to live (6d-ii). Shown only on a
 * `.recycled` `contextValue`. When the item carries no `previousParent` link
 * ({@link isRestorable} — Finding 81's rare case, which the menu also hides),
 * there is nowhere to send it, so this says so rather than calling the adapter.
 */
async function restore(
  deps: ContentCommandDeps,
  item: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || item === undefined) {
    reportNoTarget(adapter);
    return;
  }

  if (!isRestorable(item)) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t(
        'SAS Viya did not record where "{0}" used to live, so it can\'t be restored from here. Restore it in SAS Studio instead.',
        item.name,
      ),
    );
    return;
  }

  await run(
    deps,
    undefined,
    (signal) => adapter.restoreItem(item, signal),
    vscode.l10n.t('Restoring "{0}"…', item.name),
  );
}

/**
 * "Empty Recycle Bin" (6d-ii). Shown on the Recycle Bin delegate. Permanently
 * deletes every folder/file the bin lists; the adapter resolves `@myRecycleBin`
 * itself, so the tree node is only the menu anchor.
 */
async function emptyBin(deps: ContentCommandDeps): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined) {
    reportNoTarget(adapter);
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    vscode.l10n.t("Permanently delete everything in the Recycle Bin?"),
    {
      modal: true,
      detail: vscode.l10n.t(
        "This cannot be undone. Items other tools placed here, such as reports, are left alone — remove those in SAS Studio.",
      ),
    },
    vscode.l10n.t("Empty Recycle Bin"),
  );
  if (confirm === undefined) return;

  await run(
    deps,
    undefined,
    (signal) => adapter.emptyRecycleBin(signal),
    vscode.l10n.t("Emptying the Recycle Bin…"),
  );
}

/**
 * Add the item to, or remove it from, My Favorites (6d-i). No name prompt and no
 * confirmation — it is a one-click, fully reversible toggle. `run` reloads the
 * whole tree afterwards, which re-marks every visible row and refreshes the My
 * Favorites folder itself.
 *
 * A Recycle Bin item is not favouritable — `presentation.ts` gives it a
 * `.recycled` `contextValue` the menu `when` clauses exclude, so this handler is
 * only reached for one programmatically. That guard is checked first, before the
 * session, because it is a fact about the clicked item, not about auth state.
 */
async function favorite(
  deps: ContentCommandDeps,
  item: ContentItem | undefined,
  action: "add" | "remove",
): Promise<void> {
  if (item?.inRecycleBin === true) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Restore this item from the Recycle Bin before adding it to My Favorites.",
      ),
    );
    return;
  }

  const adapter = deps.adapter();
  if (adapter === undefined || item === undefined) {
    reportNoTarget(adapter);
    return;
  }

  await run(
    deps,
    undefined,
    (signal) =>
      action === "add"
        ? adapter.addToFavorites(item, signal)
        : adapter.removeFromFavorites(item, signal),
    action === "add"
      ? vscode.l10n.t('Adding "{0}" to My Favorites…', item.name)
      : vscode.l10n.t('Removing "{0}" from My Favorites…', item.name),
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
