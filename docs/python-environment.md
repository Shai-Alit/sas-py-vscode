# The Python environment

Your code runs against the Python interpreter your Viya administrator
configured and manages — not one you installed. **Python on Viya: Show
Environment** tells you what that interpreter is and what is installed in it.

## Show Environment

Run **Python on Viya: Show Environment** from the Command Palette, or click the
environment item in the status bar — the one to the right of the profile,
visible once the run target is a Viya profile.

It opens a read-only document beside your code showing:

- the **interpreter version** and the path to its **executable**;
- when the answer was **probed**;
- every installed distribution, with its version.

The document is plain text, so <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>F</kbd>
searches it — which is the point, on a stock Viya 4 the list runs to a few
hundred entries. The package list comes from `importlib.metadata`, the
interpreter's own record of what is installed, not from shelling out to `pip`.
A distribution whose metadata is too broken to read is skipped rather than
blanking or crashing the list.

## It is probed once, then cached

Asking the deployment costs a real `PROC PYTHON` round trip, and the answer
changes about as often as your administrator rebuilds the environment — rarely.
So the first **Show Environment** for a profile probes, and every one after
that is served instantly from a cache. The cache is per profile, kept in the
editor's global state, so it survives a window reload and is shared between
every folder you open that profile from. A fresh window with a cached answer
does not connect just to show it to you.

There is **no automatic refresh**. A cached answer is current until you say
otherwise.

## Refresh Environment Info

**Python on Viya: Refresh Environment Info** re-probes even when a cached
answer exists. If the environment document is already open, it updates in place
— the same tab, the fresh answer, no second tab.

Run it after your administrator tells you the environment changed, or when a
`ModuleNotFoundError` disagrees with what the cached list says is installed.

## Probing does not touch your session

The probe runs a fixed, extension-authored script — never your code — and
writes its answer to a file in the session's working directory rather than
printing it, so a few hundred package names cannot be line-wrapped into
nonsense by the log. It does not restart the interpreter and it does not leave
`sys`, `json` or `importlib` bound in your namespace afterwards. A variable you
set before a refresh is still set after it.

It does share the [one-run-at-a-time](running-python.md#one-run-at-a-time)
rule: triggering **Show Environment** while a run is in flight is refused, the
same way a second run would be. There is simply nothing to cancel a probe with.

## When it does not work

**"The run target is Local Python."** / **"No SAS Viya connection profile is
selected."** Same as for a run — set the target to a Viya profile with
**Select Run Target**.

**The probe fails.** Usually this means `PROC PYTHON` is not available on the
deployment or the context you connected with — a context whose SAS server has
no Python interpreter configured connects happily and then cannot run
anything. The **Python on Viya** log carries the deployment's own wording.

**The document says the environment "has not been probed yet."** The cache was
cleared (the profile was removed and re-added, say). Run **Show Environment**
again to re-probe.

## What is not here yet

**Searching or installing packages.** This is a read-only view. Adding a
package to the environment is your administrator's job, not the extension's.

**Modules that are not distributions.** The list is what `importlib.metadata`
reports as installed distributions. A module that is importable without being
packaged as one will not show up, even though `import` finds it.

## Where the details are

- [Diagnostics](diagnostics.md) — where the `ModuleNotFoundError` pointer that
  sends people here comes from.
- [Capability probing](architecture/capability-probing.md) — the staged
  probing model this is the second stage of.
