#!/bin/zsh
# Keeps the glass fork (dyascj/t3code, branch glass) on the latest stable
# T3 Code release, builds it, and swaps it into /Applications. See .github/README.md.
#
#   scripts/glass-update.sh              update to the newest stable, build, install
#   scripts/glass-update.sh --build-only update and build, leave the installed app alone
#   scripts/glass-update.sh --install    install the last build without rebuilding
#
# If a new release conflicts with the fork's changes, it stops before
# building and the installed app is left untouched.

set -euo pipefail

# The checkout this script lives in, through any symlink to it.
REPO="${0:A:h:h}"
APP_NAME="T3 Code (Beta)"
APP="/Applications/$APP_NAME.app"
BUNDLE_ID="com.t3tools.t3code"
BACKUP_DIR="$HOME/.t3-glass-backups"
BUILD_DIR="$REPO/release-glass"

mode="all"
case "${1:-}" in
  --build-only) mode="build" ;;
  --install) mode="install" ;;
  "") ;;
  *) echo "usage: glass-update.sh [--build-only | --install]"; exit 2 ;;
esac

say() { print -P "%F{cyan}==>%f $1"; }
fail() { print -P "%F{red}error:%f $1" >&2; exit 1; }

cd "$REPO"
# T3's native resource monitor needs Rust. A private toolchain under
# ~/.t3-glass-rust keeps Homebrew's Rust untouched; without one, any cargo on
# PATH works.
if [[ -x "$HOME/.t3-glass-rust/cargo/bin/cargo" ]]; then
  export RUSTUP_HOME="$HOME/.t3-glass-rust/rustup" CARGO_HOME="$HOME/.t3-glass-rust/cargo"
  export PATH="$CARGO_HOME/bin:$PATH"
  rustup update stable --no-self-update >/dev/null 2>&1 || true
fi
export PATH="$REPO/node_modules/.bin:$PATH"
command -v cargo >/dev/null || fail "Rust is missing. Install it from https://rustup.rs and run this again."

latest_stable() {
  git tag -l 'v*' --sort=-v:refname | command grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1
}

current_base() {
  git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' glass
}

update_and_build() {
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "$REPO has uncommitted changes. Commit or stash them first."
  git checkout -q glass

  say "Fetching T3 Code releases"
  git remote get-url upstream >/dev/null 2>&1 ||
    git remote add upstream https://github.com/pingdotgg/t3code.git
  # Upstream re-points moving tags (nightlies), so let them update.
  git fetch -q --force upstream --tags
  local latest base
  latest=$(latest_stable)
  base=$(current_base)

  if [[ "$latest" == "$base" ]]; then
    say "Already on the latest stable ($latest)"
  else
    say "Moving the fork from $base to $latest"
    if ! git rebase -q --onto "$latest" "$base" glass; then
      git rebase --abort
      fail "$latest conflicts with the fork's changes. Nothing was installed. Resolve the rebase by hand, then run this again."
    fi
    # Only the fork's owner can push; everyone else keeps the rebase locally.
    if git push -q --force-with-lease origin glass 2>/dev/null; then
      say "Pushed the updated fork to GitHub"
    else
      say "Rebased locally (no push access to origin)"
    fi
  fi

  say "Installing dependencies"
  CI=true pnpm install --silent

  local version="${latest#v}"
  say "Building $APP_NAME $version with the glass changes (takes a few minutes)"
  rm -rf "$BUILD_DIR"
  # No update repository: a local build never auto-updates over itself.
  env -u GITHUB_REPOSITORY -u T3CODE_DESKTOP_UPDATE_REPOSITORY \
    node scripts/build-desktop-artifact.ts \
      --platform mac --target zip --arch arm64 \
      --build-version "$version" --output-dir "$BUILD_DIR"

  local zip
  zip=$(command ls "$BUILD_DIR"/*.zip 2>/dev/null | head -1)
  [[ -n "$zip" ]] || fail "The build produced no zip in $BUILD_DIR."
  rm -rf "$BUILD_DIR/app" && mkdir -p "$BUILD_DIR/app"
  ditto -x -k "$zip" "$BUILD_DIR/app"
  local built="$BUILD_DIR/app/$APP_NAME.app"
  [[ -d "$built" ]] || fail "The zip did not contain $APP_NAME.app."
  # Local builds are unsigned; Apple Silicon only runs signed code, so sign ad hoc.
  codesign --force --deep --sign - "$built" 2>/dev/null
  codesign --verify --deep "$built" || fail "The built app failed signature verification."
  say "Built $built"
}

install_build() {
  local built="$BUILD_DIR/app/$APP_NAME.app"
  [[ -d "$built" ]] || fail "No build found. Run glass-update.sh first."

  # Ask macOS by bundle id; app names with parentheses break pgrep patterns.
  app_running() { [[ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" == "true" ]]; }
  if app_running; then
    say "Quitting $APP_NAME"
    osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    for _ in {1..60}; do
      app_running || break
      sleep 1
    done
    app_running && fail "$APP_NAME did not quit. Quit it yourself and run glass-update.sh --install."
  fi

  local stamp="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$stamp"
  say "Backing up the current app and database to $stamp"
  # Database first: if the copy fails, the installed app has not been touched.
  if [[ -f "$HOME/.t3/userdata/state.sqlite" ]]; then
    node --no-warnings -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1],{readOnly:true}); db.exec(\"VACUUM INTO '\"+process.argv[2]+\"'\"); db.close()" \
      "$HOME/.t3/userdata/state.sqlite" "$stamp/state.sqlite"
  fi
  [[ -d "$APP" ]] && mv "$APP" "$stamp/"
  # 0.1.0 renamed the app from Alpha to Beta; retire the old bundle too.
  [[ -d "/Applications/T3 Code (Alpha).app" ]] && mv "/Applications/T3 Code (Alpha).app" "$stamp/"
  # Keep only the newest backup; each holds a full database copy.
  command ls -1d "$BACKUP_DIR"/*/ 2>/dev/null | sort -r | tail -n +2 | while read -r old; do rm -rf "$old"; done

  say "Installing"
  ditto "$built" "$APP"
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
  open "$APP"
  say "Done. $APP_NAME is the glass build."
}

case "$mode" in
  all) update_and_build; install_build ;;
  build) update_and_build ;;
  install) install_build ;;
esac
