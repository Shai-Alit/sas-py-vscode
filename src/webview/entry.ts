// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The result panel's actual browser bootstrap — ADR-0021's layer 3, and the
 * only file this feature puts under `src/webview/`.
 *
 * Deliberately as thin as this feature can make it: a direct forward from
 * {@link DomPort} to the real `document`, the real `acquireVsCodeApi()`, and a
 * message listener. Every decision that could be wrong — what a `RenderItem`
 * becomes, whether an incoming message is shaped the way it claims to be — is
 * made by `src/run/resultPanelDom.ts` and `src/run/resultPanelModel.ts`,
 * neither of which import `vscode` or need a DOM type, and both of which are
 * unit-tested in the ordinary tier. Nothing here is inside the coverage
 * denominator (`.c8rc.json`, `check-coverage-scope.mjs`'s `isBrowserOnly`) —
 * not because it is untested, but because `acquireVsCodeApi` and `document` do
 * not exist under the unit tier's Node process, the same kind of unreachable a
 * module importing `vscode` already is.
 */

import { applyMessage, type DomPort } from "../run/resultPanelDom";
import { isResultPanelMessage } from "../run/resultPanelModel";

/** What `src/run/resultPanel.ts`'s `acquireVsCodeApi()` shape actually needs —
 * VS Code ships no `@types/vscode-webview` dependency for this, and the whole
 * surface this file uses is one method. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

const realPort: DomPort<HTMLElement> = {
  createElement: (tag) => document.createElement(tag),
  setAttribute: (element, name, value) => {
    element.setAttribute(name, value);
  },
  setText: (element, text) => {
    element.textContent = text;
  },
  setMarkup: (element, html) => {
    // Safe only because the panel's own CSP (ADR-0021) forbids any script
    // from this source from executing, whatever this string contains.
    element.innerHTML = html;
  },
  appendChild: (parent, child) => {
    parent.appendChild(child);
  },
  clear: (element) => {
    element.replaceChildren();
  },
  onActivate: (element, handler) => {
    element.addEventListener("click", handler);
    element.addEventListener("keydown", (event) => {
      // Enter or Space activates a `role="button"` element, matching how a
      // real `<button>` behaves; Space is also the page-scroll key, so it
      // is prevented from doing both.
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  },
};

const root = document.getElementById("root");
const vscodeApi = acquireVsCodeApi();

if (root !== null) {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (isResultPanelMessage(event.data)) {
      applyMessage(realPort, root, event.data, (frameIndex, runToken) => {
        // Webview → host, Phase 4d: the user activated a traceback frame.
        // The host holds the structured frames and the run's origin and
        // does the mapping — see `src/run/resultPanelModel.ts`'s
        // `RevealFrameMessage`. `runToken` (5d-iv) rode in on the traceback
        // item; echoing it lets the host ignore a click from a superseded run.
        vscodeApi.postMessage({ type: "revealFrame", frameIndex, runToken });
      });
    }
  });
}

// Sent once the listener above is attached — src/run/resultPanel.ts buffers
// every message until this arrives, which is what closes the one real race in
// a freshly created panel (a message posted before this script has loaded is
// simply lost otherwise).
vscodeApi.postMessage({ type: "ready" });
