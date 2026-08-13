# Connection profiles

A connection profile tells the extension which SAS Viya deployment to run your
Python on. You need at least one before anything else in the extension does
something useful.

## Creating one

Open the Command Palette and run **Python on Viya: Add Connection Profile**. You
will be asked for four things, and only the first two are required.

**Profile name.** Whatever you want to see in the status bar — `Production`,
`Dev sandbox`, a customer's name. Names have to be unique, and two profiles that
differ only in capitalisation count as the same name. That restriction exists
because `Prod` and `prod` sitting next to each other in a picker is a mistake
worth preventing rather than diagnosing.

**Endpoint.** The address of the deployment, for example
`https://viya.example.com`. You can leave the scheme off and it will be filled in
as HTTPS. A trailing slash is trimmed. Three things are refused outright:

- **Plain HTTP to anything but a loopback address.** Every request carries an
  access token in a header, and over HTTP that token is readable by anything on
  the network path. `http://localhost:8080` is accepted, because there is no
  network path to listen on.
- **A username or password in the URL.** `https://user:secret@viya.example.com` <!-- credential-scan: allow an illustration of the shape this rule refuses -->
  puts a credential into a settings file. Sign-in prompts are for credentials.
- **A query string or fragment.** These are never part of a deployment's address
  and almost always mean a whole browser URL was pasted in.

**Compute context** (optional). The name of the SAS compute context to run in.
Leave it empty for now if you do not know it.

**OAuth client ID** (optional). If you enter one you are then asked for the
client secret, and that prompt is masked.

Nothing reads either value yet — signing in arrives in a later release — but
what they will mean is already decided, so you can fill them in now.

On **Viya 4 2022.11 and later**, leave both empty. Those deployments register a
built-in public client called `vscode`, and that is what this extension will
use. You do not need an administrator to set anything up.

On **Viya 3.5, and Viya 4 2022.10 and earlier**, there is no such client, and
you do need one: ask your Viya administrator to register a client with the
`authorization_code` and `refresh_token` grant types, then put the ID here and
the secret in the prompt that follows.

Both of those are
[SAS's documented behaviour](https://github.com/sassoftware/vscode-sas-extension/blob/main/website/docs/Configurations/Profiles/viya.md)
for their own extension rather than something this project has yet confirmed
against a deployment of each generation. If the empty-field path fails on a
deployment you believe is 2022.11 or later, that is worth reporting — it means
this page is wrong, not that you did something wrong.

## Where things are stored

Profiles live in the `pythonOnViya.connectionProfiles` setting, keyed by name.
You can read them, edit them by hand, and check them into a workspace file.

The client secret is not there. It goes into the editor's own secret storage,
which is backed by your operating system keychain, and there is no setting that
will ever contain it. A settings file is a file people commit to version control,
paste into issues, and show on a screen share; a credential in one is a
credential you have to rotate later.

Because the secret is stored separately, copying a profile to another machine
moves the endpoint and the context but not the secret. You are prompted for it
once on that machine.

## Editing by hand

The setting is schema-checked, so the settings editor will complete field names
and flag unknown ones. A minimal profile is just an endpoint:

```json
{
  "pythonOnViya.connectionProfiles": {
    "Production": {
      "endpoint": "https://viya.example.com",
      "context": "SAS Job Execution compute context"
    }
  }
}
```

Two fields are filled in for you if you leave them out. `version` records the
shape of the profile so that a future release can migrate it; a profile whose
version is *newer* than your installed extension understands is refused with a
message saying so, rather than being read halfway. `id` is a stable identifier
used to key the stored secret, which is why renaming a profile does not make you
sign in again.

A profile the extension cannot read is skipped on its own — the rest of the list
still works, and the reason for the skip is written to the log. Run **Python on
Viya: Show Log** to see it. Nothing in the extension rewrites your settings file
behind your back, so a typo stays a typo until you fix it.

## Choosing which profile is active

There are two levels, and the difference matters if you work in more than one
window.

`pythonOnViya.defaultProfile` is a setting naming the profile a window starts on.
It is the one a machine setup script, a dotfiles repository or a checked-in
`.code-workspace` file can rely on.

**Python on Viya: Switch Connection Profile** overrides that for the current
workspace only. So you can point one window at a development deployment and
another at production without either affecting the other, and without editing a
file. The picker offers **Use the default** to drop back.

If you have exactly one profile, it is used without your having to choose.

The status bar shows what the current window resolved to. When nothing resolves,
it says so and takes you to the picker.

## Importing from the SAS extension

If you already use the [SAS extension for Visual Studio
Code](https://marketplace.visualstudio.com/items?itemName=SAS.sas-lsp), run
**Python on Viya: Import Connection Profiles from the SAS Extension**. It reads
that extension's profiles, shows you the ones that can be used here, and copies
the ones you select.

A few things are worth knowing about what it will and will not do.

It only imports Viya connections. The SAS extension also supports SSH, COM and
IOM connections, which are all SAS 9 transports — this extension does not support
SAS 9, so those are listed as skipped with the reason.

It never modifies the SAS extension's settings, and it does not share them.
Adding or editing a profile here has no effect on that extension, and vice versa.
That separation is deliberate and the reasoning is written up in
[ADR-0007](adr/0007-connection-profile-storage.md).

Secrets are not copied. The editor's secret storage is per-extension and cannot
be shared between two extensions, so you are asked for the client secret the
first time you connect. This is a platform limitation and not a choice.

If a profile name is already in use here, the imported one gets ` (SAS)`
appended rather than overwriting yours.

## In an untrusted workspace

Profile management works in a folder you have not trusted: you can add, edit and
switch profiles. Connecting, reading the stored secret and executing code all
require trust, because they run code on a remote server under your identity.
Workspace-scoped values for both profile settings are ignored until you trust the
folder. See [ADR-0002](adr/0002-workspace-trust-posture.md).

## What is not here yet

Signing in and running code are later slices. This one gives you somewhere to
say *where*, and the reference tables for every setting and command are generated
from the manifest in [Settings](reference/settings.md) and
[Commands](reference/commands.md).
