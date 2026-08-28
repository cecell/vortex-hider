# Hider

[![Release](https://img.shields.io/github/v/release/cecell/vortex-hider?display_name=tag)](https://github.com/cecell/vortex-hider/releases/latest)
[![Release Build](https://github.com/cecell/vortex-hider/actions/workflows/release.yml/badge.svg)](https://github.com/cecell/vortex-hider/actions/workflows/release.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

**Hider** is a lightweight Vortex extension that adds **profile-specific mod hiding** to the Mods page.

It is intended for large mod collections where some installed or downloaded mods are irrelevant to a particular profile but should not be deleted, moved, recategorized, or otherwise altered.

Hiding a mod affects only the currently active Vortex profile.

---

## Features

* **Profile-specific hiding** — each Vortex profile maintains its own hidden-mod list.
* **Hide installed, disabled mods** from the Mods page.
* **Hide downloaded/uninstalled mods** when their archive is still present.
* **Automatic unhide on enable** — enabling a hidden mod immediately removes its hidden designation for that profile.
* **Persistent across install/uninstall transitions** — a hidden archive remains hidden when installed, and a hidden installed mod remains hidden after uninstalling if its archive is retained.
* **Show Hidden mode** — temporarily display only the mods hidden for the active profile.
* **Enable or disable Hider** without losing any saved hidden state.
* **No category manipulation** — Hider does not use Vortex mod categories to implement hiding.
* **Automatic stale-state cleanup** when a profile is activated.
* Works directly with Vortex's existing Mods table and context menu.

---

## Why Hider?

A large Vortex installation can contain hundreds or thousands of mods, while an individual profile may use only a subset of them.

Disabling a mod solves the deployment problem, but it does not solve the clutter problem: disabled mods still remain in the Mods list.

Hider adds another distinction:

> **This mod exists in Vortex, but I do not want to see it while using this profile.**

For example, a mod can be:

* visible and enabled in Profile A,
* hidden and disabled in Profile B,
* visible and disabled in Profile C,

without Hider changing the mod itself or affecting the other profiles.

---

## Usage

### Hide a mod

On the Vortex **Mods** page:

1. Right-click a mod.
2. Select **Hide for profile**.

The mod immediately disappears from the Mods table for the active profile.

Installed and enabled mods cannot be hidden. Disable the mod first if you want to hide it.

Downloaded but currently uninstalled mods can also be hidden as long as their archive remains available in Vortex.

---

### View hidden mods

Right-click a mod and select:

**Show hidden mods**

Hider switches the Mods table into a filtered view containing the mods hidden for the current profile.

While this view is active, the action changes to:

**Hide hidden mods**

Selecting it returns the Mods page to its normal view.

Vortex's standard **Clear all filters** action also exits Show Hidden mode.

---

### Unhide a mod

While viewing hidden mods:

1. Right-click the mod.
2. Select **Unhide for profile**.

The mod returns to the normal Mods view.

If it was the last hidden mod in the profile, Hider automatically exits Show Hidden mode.

---

### Enabling a hidden mod

Enabling a hidden mod is treated as an explicit request to use that mod.

Hider therefore automatically removes its hidden designation from the **active profile**.

This does not alter the hidden state of the same mod in any other profile.

---

## Install and Uninstall Behavior

Hider tracks archive-backed mods in a way that allows their hidden state to survive normal installation changes.

| Action                                              | Hidden state                                                |
| --------------------------------------------------- | ----------------------------------------------------------- |
| Hide an installed, disabled mod                     | Remains hidden                                              |
| Install a hidden downloaded mod without enabling it | Remains hidden                                              |
| Uninstall a hidden mod but keep its archive         | Remains hidden                                              |
| Enable a hidden mod                                 | Automatically unhidden                                      |
| Delete both the installed mod and its archive       | Stale hidden entry is removed during profile reconciliation |

This makes hiding represent the mod itself rather than merely its current installed/uninstalled state.

---

## Profile Isolation

Hidden state belongs to the Vortex profile in which it was created.

Switching profiles does not copy, remove, or otherwise alter another profile's hidden entries.

When a profile becomes active, Hider reconciles **only that profile** against the current Vortex mod and archive state.

For example:

```text
Profile A
    Mod X: disabled + hidden

Profile B
    Mod X: enabled + visible
```

Enabling Mod X in Profile B does not unhide it in Profile A.

---

## Disable Hider

Hider itself can be temporarily disabled from the Mods-page context menu:

**Disable Hider**

This immediately reveals hidden mods but leaves all profile-specific hidden bookkeeping intact.

Select:

**Enable Hider**

to restore hiding.

This is useful for temporarily viewing the complete Vortex Mods list without destroying your profile-specific organization.

---

## Search Behavior

Hider deliberately hides Mods-table rows at the display level.

Because Vortex performs its normal search/filter processing independently, a hidden mod can still be reflected in the Mods-page result count even though its row remains invisible.

For example, searching for the exact name of one hidden mod may produce a count such as:

```text
1 / 4596
```

while displaying no matching row.

This is intentional and can serve as a useful reminder that a matching mod exists but is hidden for the current profile.

---

## Installation

Download the latest:

```text
Hider-vX.Y.Z.zip
```

from the [Releases](https://github.com/cecell/vortex-hider/releases) page.

For manual installation, extract the archive to:

```text
%APPDATA%\Vortex\plugins\Hider\
```

The resulting directory should contain:

```text
Hider\
├── index.js
└── info.json
```

Restart Vortex after installing or updating the extension.

---

## Building from Source

### Requirements

* Node.js
* npm
* Git

Clone the repository:

```bash
git clone https://github.com/cecell/vortex-hider.git
cd vortex-hider
```

Install dependencies:

```bash
npm ci
```

Type-check:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

The extension is written in TypeScript and bundled with esbuild.

Build output is placed in:

```text
dist/
├── index.js
├── index.js.map
└── info.json
```

`vortex-api` is supplied by Vortex at runtime and is therefore not bundled into the extension.

---

## Releases

Releases are built automatically with GitHub Actions.

A release tag must match the version in both:

```text
package.json
info.json
```

For example:

```text
package.json  →  0.2.0
info.json     →  0.2.0
Git tag       →  v0.2.0
```

Pushing the tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

causes GitHub Actions to:

1. install dependencies,
2. type-check the project,
3. build the extension,
4. verify the version numbers,
5. package `index.js` and `info.json`,
6. create the GitHub release.

---

## Technical Notes

Hider stores its persistent data inside Vortex's Redux state under:

```text
settings.hider
```

No separate Hider configuration file is required.

Archive-backed mods use their Vortex archive identity whenever possible. This allows the same hidden designation to follow a mod between its downloaded and installed forms.

If no archive identity exists, Hider falls back to the installed mod identity.

Hider does **not** use Vortex categories to hide mods. Current versions contain only migration cleanup for category data that may have been written by early prototype builds.

---

## Scope

Hider is intentionally narrow in scope.

It does not:

* enable or disable mods on its own,
* uninstall mods,
* delete archives,
* change deployment behavior,
* change mod categories,
* synchronize hidden state between profiles.

Its job is simply to decide whether a mod should be visible on the Mods page for the active profile.

---

## License

Hider is licensed under the **GNU General Public License v3.0 only**.

See [LICENSE](LICENSE) for the full license text.

---

## Author

**Cecell**

GitHub: [@cecell](https://github.com/cecell)
