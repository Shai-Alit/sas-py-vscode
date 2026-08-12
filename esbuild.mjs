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
  format: "cjs",
  platform: "node",
  target: "node20",

  // Provided by the extension host at runtime; bundling it would break loading.
  external: ["vscode"],

  sourcemap: production ? false : "linked",
  minify: production,
  logLevel: "warning",
  plugins: [problemMatcherPlugin],
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
