// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * VitePress configuration for the documentation site.
 *
 * Written as `.mjs` rather than the more usual `.mts` so it lands in the
 * existing `**\/*.mjs` ESLint block alongside the other tooling scripts. A
 * `.mts` file would need type information, which would mean a third tsconfig
 * for the sake of one file, and an unlinted config is how a config quietly
 * rots.
 *
 * The build is a CI gate, not just a preview: VitePress fails on dead internal
 * links by default, and `ignoreDeadLinks` is deliberately left off. That is the
 * whole reason this generator was chosen over the alternatives — the link check
 * rides along with a build we want anyway rather than arriving as a second tool
 * that has to be taught the same conventions.
 *
 * Deploying the site is Phase 5c. This slice only builds it.
 */

import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Python on Viya",
  description:
    "Write Python locally, run it on SAS Viya. Documentation for the VS Code extension.",

  // Repo-root `site/`, which .gitignore already excludes. Keeping build output
  // out of `docs/` means the source tree a contributor edits and the tree the
  // site is generated from stay the same set of files.
  outDir: "../site",

  // GitHub renders `README.md` as a directory's landing page; VitePress wants
  // `index.md`. Rewriting rather than renaming keeps both readers happy — the
  // docs stay browsable on GitHub, which is where most people will meet them
  // before the site is deployed.
  rewrites: {
    "README.md": "index.md",
    "adr/README.md": "adr/index.md",
    "architecture/README.md": "architecture/index.md",
    "dev/README.md": "dev/index.md",
  },

  themeConfig: {
    nav: [
      { text: "Guide", link: "/connection-profiles" },
      { text: "Reference", link: "/reference/settings" },
      { text: "Contributing", link: "/dev/" },
      {
        text: "GitHub",
        link: "https://github.com/Shai-Alit/sas-py-vscode",
      },
    ],

    sidebar: [
      {
        // User-facing pages come first and stay first. A reader who arrives
        // looking for "how do I connect" should not have to scroll past the
        // contributor documentation to find out.
        text: "Using the extension",
        collapsed: false,
        items: [
          { text: "Connection profiles", link: "/connection-profiles" },
          { text: "Signing in", link: "/signing-in" },
          { text: "Connecting to Viya", link: "/connecting" },
        ],
      },
      {
        text: "Reference",
        collapsed: false,
        items: [
          { text: "Settings", link: "/reference/settings" },
          { text: "Commands", link: "/reference/commands" },
        ],
      },
      {
        text: "Contributing",
        collapsed: false,
        items: [
          { text: "Overview", link: "/dev/" },
          { text: "Building and debugging", link: "/dev/building" },
          { text: "Testing", link: "/dev/testing" },
          { text: "Manual test pass", link: "/dev/manual-test-pass" },
          { text: "Continuous integration", link: "/dev/ci" },
        ],
      },
      {
        text: "Architecture",
        collapsed: false,
        items: [
          { text: "Overview", link: "/architecture/" },
          {
            text: "Execution backends",
            link: "/architecture/execution-backends",
          },
          { text: "The dialect layer", link: "/architecture/dialects" },
          {
            text: "Capability probing",
            link: "/architecture/capability-probing",
          },
          { text: "API contracts", link: "/architecture/contracts" },
          { text: "Decision records", link: "/adr/" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/Shai-Alit/sas-py-vscode" },
    ],

    editLink: {
      pattern:
        "https://github.com/Shai-Alit/sas-py-vscode/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the Apache-2.0 licence.",
      copyright:
        "Copyright © 2026 Sean Ford and the Python on Viya contributors",
    },
  },
});
