<!--
  GENERATED FILE — DO NOT EDIT.

  Produced by scripts/generate-reference.mjs from package.json.
  Run `npm run docs:reference` after changing a contribution point, and commit
  the result. CI fails if this file does not match what package.json produces.
-->

# Settings

Every setting contributed by **Python on Viya**, generated from `package.json`.

| Setting | Type | Default | Scope | Description |
| --- | --- | --- | --- | --- |
| `pythonOnViya.connectionProfiles` | `object` | `{}` | `resource` | SAS Viya connection profiles. Populated by the profile commands in Phase 1; edit by hand at your own risk. Workspace-scoped values are ignored in untrusted folders. † |
| `pythonOnViya.defaultProfile` | `string` | `""` | `resource` | Name of the connection profile to use when none is explicitly selected. Workspace-scoped values are ignored in untrusted folders. † |

† **Restricted in untrusted workspaces.** The workspace-scoped value is ignored
until you trust the folder, because acting on it would run code on a remote
server under your identity. See
[ADR-0002](../adr/0002-workspace-trust-posture.md).
