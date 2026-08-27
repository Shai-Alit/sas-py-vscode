// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * Reports build failures in a form VS Code's problem matcher understands, so a
 * failed watch build surfaces in the Problems panel rather than scrolling past.
 */
const problemMatcherPlugin = {
  name: "problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[build] started");
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(
            `    ${location.file}:${location.line}:${location.column}:`,
          );
        }
      }
      console.log(`[build] finished with ${result.errors.length} error(s)`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",

  // The extension host loads CommonJS from Node. Not a browser target — see
  // docs/adr/0003-extension-host-target.md.
  //
  // The target tracks the Node the extension host actually runs, which is
  // derived from `engines.vscode` and not chosen here: VS Code has run Node 22
  // in the extension host since 1.101, and 1.104 — our floor — embeds 22.18.0.
  // See docs/adr/0018-the-node-baseline.md. Setting this lower does not buy
  // compatibility with anything; it only makes esbuild down-level syntax that
  // every host we support already understands.
  format: "cjs",
  platform: "node",
  target: "node22",

  // Provided by the extension host at runtime; bundling it would break loading.
  external: ["vscode"],

  sourcemap: production ? false : "linked",
  minify: production,
  logLevel: "warning",
  plugins: [problemMatcherPlugin],
});

// The result panel's own bundle (ADR-0021, 3d-ii) — a second, independent
// context because it targets a browser inside a `WebviewPanel`, never Node.
// `src/webview/` never imports `vscode`, so there is nothing to mark
// `external` here; a webview has no access to Node or Electron APIs regardless
// of what esbuild does or does not bundle. `format: "iife"` because this loads
// as a plain `<script>` tag in the panel's own HTML shell
// (`src/run/resultPanel.ts`), not as a module the panel's CSP would have to
// carry a `type="module"` allowance for.
const webviewContext = await esbuild.context({
  entryPoints: ["src/webview/entry.ts"],
  bundle: true,
  outfile: "dist/webview/resultPanel.js",

  format: "iife",
  platform: "browser",
  // Electron's bundled Chromium, not a Node version — this file never runs in
  // the extension host. es2022 is a safe floor for whatever Chromium version
  // ships with the Electron build behind our `engines.vscode` floor.
  target: "es2022",

  sourcemap: production ? false : "linked",
  minify: production,
  logLevel: "warning",
  plugins: [problemMatcherPlugin],
});

if (watch) {
  await context.watch();
  await webviewContext.watch();
} else {
  await context.rebuild();
  await webviewContext.rebuild();
  await context.dispose();
  await webviewContext.dispose();
}
