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
| `pythonOnViya.connectionProfiles` | `object` | `{}` | `window` | SAS Viya connection profiles, keyed by the name you want to see in the status bar. Normally managed by the profile commands, but hand-editing is supported and validated. No client secret is stored here: secrets go to the editor's secret storage, and a profile containing one would be a credential in a file you can commit. † |
| `pythonOnViya.defaultProfile` | `string` | `""` | `window` | Name of the connection profile a window starts on. Switching profile overrides this for the current workspace only, so this setting is the one a machine setup script or a checked-in workspace file can rely on. Ignored if it names a profile that does not exist. † |

† **Restricted in untrusted workspaces.** The workspace-scoped value is ignored
until you trust the folder, because acting on it would run code on a remote
server under your identity. See
[ADR-0002](../adr/0002-workspace-trust-posture.md).
