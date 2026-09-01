// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Applies one {@link ResultPanelMessage} to a document, expressed against
 * {@link DomPort} rather than against `lib.dom.d.ts`'s real `HTMLElement`.
 *
 * **This module must never import `vscode`, and deliberately needs no DOM
 * library types either** — ADR-0021. `DomPort` is this module's own small
 * interface, not a borrowed one, which is exactly what keeps this file
 * loadable under the ordinary Node-only unit tier: nothing in it references a
 * global that does not exist there. The real implementation
 * (`src/webview/entry.ts`) is a thin, direct forward from each `DomPort`
 * method to the genuine `document`; tests use a fake that records what was
 * asked of it — the same "port for the one thing a test cannot supply for
 * real" shape `RunOutputChannelDeps.createChannel` already uses for
 * `vscode.OutputChannel`.
 *
 * Accessibility is decided here, not deferred: an image gets its `alt` text
 * from the {@link RenderItem} it was handed (never invented in this module);
 * `text/html` output is inserted as markup so a pandas table's own `<table>`
 * survives as a real table rather than becoming an unlabelled block of text; a
 * traceback becomes a heading, a message paragraph and a genuine list of
 * frames, not a wall of concatenated text.
 */

import { STRING_FRAME_FILE } from "../backend/tracebackDiagnostics";
import type { RenderItem, ResultPanelMessage } from "./resultPanelModel";

/**
 * The handful of operations rendering the result panel actually needs.
 * Generic over `El` — the concrete element representation — so the real
 * implementation can hand back genuine `HTMLElement`s while a test hands back
 * whatever plain object its fake finds convenient to inspect.
 */
export interface DomPort<El> {
  createElement(tag: string): El;
  setAttribute(element: El, name: string, value: string): void;
  /** Sets an element's text content. Escapes automatically in a real DOM
   * (`Node.textContent`'s own contract) — the safe default for everything
   * that is not deliberately markup. */
  setText(element: El, text: string): void;
  /** Sets an element's content as markup, not text — the one operation this
   * port needs beyond {@link setText}, because a `text/html` output's own
   * `<table>` must survive as real markup. Safe only because the panel's CSP
   * (ADR-0021) never lets a script from this source execute, whatever it
   * contains — this method must never be used for anything the CSP does not
   * already make inert. */
  setMarkup(element: El, html: string): void;
  appendChild(parent: El, child: El): void;
  /** Removes every child of `element`, for `"reset"`. */
  clear(element: El): void;
  /** Registers a "the user activated this element" handler — a pointer
   * click, or Enter/Space while it is focused. Added in Phase 4d for
   * clickable traceback frames; the real implementation
   * (`src/webview/entry.ts`) wires both a `click` and a `keydown` listener,
   * a test fake just records the handler. Only ever called on an element
   * this module has already given `role="button"` and `tabindex="0"`. */
  onActivate(element: El, handler: () => void): void;
}

/** Applies one message to `root` through `port`. Stateless beyond what is
 * already in the document: `"reset"` clears `root`, everything else appends
 * one more node to it. Safe to call repeatedly as messages stream in — it
 * never re-reads or replaces what an earlier call already built.
 *
 * `onFrameActivate` (Phase 4d) is called with a traceback frame's index when
 * the user activates its `<li>`. Optional: a caller that does not supply it
 * (or a run whose frames are none of them mappable) renders every frame as
 * plain, non-interactive text — the pre-4d behaviour. `src/webview/entry.ts`
 * supplies one that posts a `revealFrame` message to the host. */
export function applyMessage<El>(
  port: DomPort<El>,
  root: El,
  message: ResultPanelMessage,
  onFrameActivate?: (frameIndex: number) => void,
): void {
  switch (message.type) {
    case "reset":
      port.clear(root);
      return;
    case "output":
      port.appendChild(root, buildItem(port, message.item, onFrameActivate));
      return;
    case "outcome":
      port.appendChild(
        root,
        buildOutcome(
          port,
          message.summary,
          message.succeeded,
          message.diagnostics,
        ),
      );
      return;
    case "failure":
      port.appendChild(root, buildFailure(port, message.message));
      return;
  }
}

function buildItem<El>(
  port: DomPort<El>,
  item: RenderItem,
  onFrameActivate?: (frameIndex: number) => void,
): El {
  switch (item.kind) {
    case "text": {
      const pre = port.createElement("pre");
      port.setAttribute(pre, "class", "python-on-viya-output-text");
      port.setText(pre, item.text);
      return pre;
    }
    case "image": {
      const img = port.createElement("img");
      port.setAttribute(img, "class", "python-on-viya-output-image");
      port.setAttribute(img, "src", item.dataUri);
      port.setAttribute(img, "alt", item.alt);
      return img;
    }
    case "html": {
      const container = port.createElement("div");
      port.setAttribute(container, "class", "python-on-viya-output-html");
      port.setMarkup(container, item.markup);
      return container;
    }
    case "traceback":
      return buildTraceback(port, item, onFrameActivate);
  }
}

function buildTraceback<El>(
  port: DomPort<El>,
  item: Extract<RenderItem, { kind: "traceback" }>,
  onFrameActivate?: (frameIndex: number) => void,
): El {
  const container = port.createElement("div");
  port.setAttribute(container, "class", "python-on-viya-traceback");

  const heading = port.createElement("h3");
  port.setText(heading, item.heading);
  port.appendChild(container, heading);

  const message = port.createElement("p");
  port.setAttribute(message, "class", "python-on-viya-traceback-message");
  port.setText(message, item.message);
  port.appendChild(container, message);

  if (item.frameLines.length > 0) {
    const list = port.createElement("ol");
    port.setAttribute(list, "class", "python-on-viya-traceback-frames");
    // Each line arrives already formatted and already localised by
    // `resultPanelModel.ts`'s caller (ADR-0021's host-side localisation
    // boundary) — this layer only ever puts it in an `<li>` as text. Phase
    // 4d: an `<li>` whose matching `frames` entry is a mappable `<string>`
    // frame also becomes a button — `role`/`tabindex` so a keyboard reaches
    // it, an activation handler that hands the frame's index back to the
    // host. `frameLines` and `frames` are the same frames in the same
    // order (`resultPanelModel.ts`), so the index is shared.
    item.frameLines.forEach((line, index) => {
      const entry = port.createElement("li");
      port.setText(entry, line);
      if (
        onFrameActivate !== undefined &&
        item.frames[index]?.file === STRING_FRAME_FILE
      ) {
        port.setAttribute(
          entry,
          "class",
          "python-on-viya-traceback-frame python-on-viya-traceback-frame-clickable",
        );
        port.setAttribute(entry, "role", "button");
        port.setAttribute(entry, "tabindex", "0");
        port.onActivate(entry, () => {
          onFrameActivate(index);
        });
      }
      port.appendChild(list, entry);
    });
    port.appendChild(container, list);
  }

  return container;
}

function buildOutcome<El>(
  port: DomPort<El>,
  summary: string,
  succeeded: boolean,
  diagnostics: readonly string[],
): El {
  const container = port.createElement("div");
  port.setAttribute(
    container,
    "class",
    succeeded
      ? "python-on-viya-outcome python-on-viya-outcome-success"
      : "python-on-viya-outcome python-on-viya-outcome-failure",
  );

  const summaryEl = port.createElement("p");
  port.setText(summaryEl, summary);
  port.appendChild(container, summaryEl);

  if (diagnostics.length > 0) {
    const list = port.createElement("ul");
    for (const diagnostic of diagnostics) {
      const entry = port.createElement("li");
      port.setText(entry, diagnostic);
      port.appendChild(list, entry);
    }
    port.appendChild(container, list);
  }

  return container;
}

function buildFailure<El>(port: DomPort<El>, message: string): El {
  const paragraph = port.createElement("p");
  port.setAttribute(paragraph, "class", "python-on-viya-outcome-failure");
  port.setText(paragraph, message);
  return paragraph;
}
