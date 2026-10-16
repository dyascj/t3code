# T3 Code Glass

A fork of [T3 Code](https://github.com/pingdotgg/t3code) that follows its stable releases and adds:

- **Window glass.** On macOS in dark mode the window is translucent and blurs the desktop behind it.
- **Appearance controls.** Tint color, sidebar translucency, and blur strength in Settings > Appearance.
- **Chat backgrounds.** An image behind your chats, globally or per project, with effects: Dither, ASCII, Halftone, Scanlines, and Haze (blurred and dithered by default).
- **Home.** Opening the app lands in a new No project chat: just the composer, nothing else.
- **Skills.** Settings > Skills lists every skill your providers report, across every environment, with its scope, provider, and path.
- **Neutral glass and calm motion.** The composer, menus, pickers, command bar, and dialogs share one neutral glass with hairline borders, and surfaces ease in with a short scale and drift.
- **A slimmer glass sidebar.** T3 Code's own thread list (pinned, snoozed, settled, and the beta Working section, live status, drag a thread into the composer) at a narrower default width, sitting on the glass. Collapse it (drag it shut or press `Mod+\`) and it becomes a slim rail: Search on top, your threads as project icons with their live status in a scrolling middle, and Usage, Pull Requests, and Settings at the bottom. `Mod+B` flips between chat backgrounds, each with its own focal point, placed in a full-size view in Settings. New thread always offers No project first. Backgrounds stay inside the content area, and text on them adapts to the art behind it.

Everything else is stock T3 Code. Backgrounds and appearance settings stay on your device.

## Where things live

- Code: the `glass` branch of [dyascj/t3code](https://github.com/dyascj/t3code/tree/glass). Its commits sit on top of the latest stable T3 Code tag, so `git log <tag>..glass` lists every change the fork makes.
- Build and update script: [`scripts/glass-update.sh`](../scripts/glass-update.sh). On CJ's Mac it is also on PATH as `t3-glass-update` (a symlink in `~/.local/bin`).
- T3 Code's own readme is still at [`README.md`](../README.md). This file lives in `.github/` so GitHub shows it on the repo page without touching upstream files, which keeps updates conflict-free.

## Build it

Requires macOS on Apple Silicon, Node 24, pnpm, and Rust ([rustup.rs](https://rustup.rs)).

```bash
git clone -b glass https://github.com/dyascj/t3code.git t3code-glass
cd t3code-glass
scripts/glass-update.sh
```

The script moves the fork onto the newest stable T3 Code release, builds the app, backs up your current `/Applications/T3 Code (Beta).app` and its database to `~/.t3-glass-backups`, and installs the new build. Run it again whenever T3 Code ships a stable release. `--build-only` stops after building; `--install` installs the last build.

If a new release conflicts with the fork, the script stops before building and leaves your installed app alone.

Local builds are signed ad hoc and never auto-update. macOS may ask once per build for access to the "T3 Code (Beta) Safe Storage" keychain item; choose Always Allow.

## Maintaining the fork

- `glass` is the only branch and the default. The other branches GitHub copied from T3 Code at fork time were deleted on purpose; T3 Code releases come from the `upstream` remote, not from branches here.
- **Never click GitHub's "Sync fork" button.** It merges T3 Code's `main`, which is nightly code, into `glass`. Update with `scripts/glass-update.sh` instead, which moves to stable tags only.
- New fork features go on `glass` as their own commits, so `git log <tag>..glass` stays a readable list of everything the fork changes.
- If the script reports a conflict: run `git rebase --onto <new tag> <old tag> glass`, fix the conflicts in the fork's commits, `git push --force-with-lease origin glass`, then run the script again.

## Notices

The background effects include third-party code under the MIT license; see [`apps/web/src/glass/THIRD_PARTY_LICENSE`](../apps/web/src/glass/THIRD_PARTY_LICENSE).
