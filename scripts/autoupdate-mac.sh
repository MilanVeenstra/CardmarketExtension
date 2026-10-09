#!/bin/bash
#
# Keep an unpacked Cart Saver install up to date with GitHub (macOS).
#
#   ./autoupdate-mac.sh install "/path/to/the/extension/folder"
#   ./autoupdate-mac.sh status
#   ./autoupdate-mac.sh uninstall
#
# `install` turns the folder Chrome loads the extension from into a git
# checkout of the repository's main branch (in place, so Chrome keeps the
# same extension and your saved data), and registers a small background job
# (launchd) that fetches the latest version every few minutes. Every new
# version is checked first (manifest, translations and scripts must load);
# one that would not load is skipped and the working version stays. The
# extension notices new files by itself and reloads; open Cardmarket tabs
# then ask for a refresh.
#
# Only for a folder that is just an installed copy: a git clone with work of
# its own (another branch, another repository, changes) is refused, because
# the job replaces whatever is in the folder.
#
# Nothing is sent anywhere: the job only downloads from the public repository.

set -euo pipefail

REPO_URL="https://github.com/MilanVeenstra/CardmarketExtension.git"
# The repository's default branch: `fetch origin HEAD` follows it, whatever it is called.
LOCAL_BRANCH="cart-saver"
LABEL="com.cardmarket-cart-saver.autoupdate"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/cart-saver-autoupdate.log"
SUPPORT="$HOME/Library/Application Support/Cart Saver Updater"
INTERVAL_SECONDS=180

usage() {
  cat <<EOF
Usage:
  $0 install "/path/to/the/extension/folder"   turn automatic updates on
  $0 status                                      show the latest updates
  $0 uninstall                                   turn automatic updates off
EOF
  exit 1
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

refuse() {
  echo "$1" >&2
  echo "Pick a separate folder for the installed extension (an unpacked ZIP, for example), not your own working copy." >&2
  exit 1
}

install() {
  local dir="${1:-}"
  [ -n "$dir" ] || usage

  local git_bin
  git_bin="$(command -v git || true)"
  if [ -z "$git_bin" ]; then
    echo "git is missing. Install it first with:  xcode-select --install" >&2
    exit 1
  fi

  mkdir -p "$dir"
  dir="$(cd "$dir" && pwd)"
  if [ -d "$dir/.git" ]; then
    # Only a copy this script made before: our repository, our branch, nothing of its own.
    local origin branch
    origin="$("$git_bin" -C "$dir" remote get-url origin 2>/dev/null || true)"
    branch="$("$git_bin" -C "$dir" symbolic-ref --short -q HEAD || true)"
    [ "$origin" = "$REPO_URL" ] || refuse "$dir is a git folder of another repository ($origin)."
    [ "$branch" = "$LOCAL_BRANCH" ] || refuse "$dir is on the branch '$branch': that looks like a working copy, not an installed one."
    [ -z "$("$git_bin" -C "$dir" status --porcelain)" ] || refuse "$dir has changes of its own; every update would wipe them."
  else
    if [ -n "$(ls -A "$dir")" ] && [ ! -f "$dir/manifest.json" ]; then
      echo "$dir is not empty and has no manifest.json. Pick the folder Chrome loads the extension from." >&2
      exit 1
    fi
    "$git_bin" -C "$dir" init -q
    "$git_bin" -C "$dir" remote add origin "$REPO_URL"
  fi
  echo "Fetching the latest version…"
  "$git_bin" -C "$dir" fetch -q origin HEAD
  # Commits that are not on GitHub would be lost: never.
  if "$git_bin" -C "$dir" rev-parse -q --verify HEAD >/dev/null; then
    "$git_bin" -C "$dir" merge-base --is-ancestor HEAD FETCH_HEAD || refuse "$dir has commits that are not on GitHub."
  fi
  "$git_bin" -C "$dir" checkout -q -f -B "$LOCAL_BRANCH" FETCH_HEAD
  "$git_bin" -C "$dir" rev-parse HEAD >"$dir/build-id.txt"

  # The job lives outside the extension folder, so an update can never break the updater itself.
  mkdir -p "$SUPPORT" "$(dirname "$PLIST")" "$(dirname "$LOG")"
  local check="$dir/scripts/check-build.js"
  [ -f "$check" ] || check="$(cd "$(dirname "$0")" && pwd)/check-build.js"
  cp "$check" "$SUPPORT/check-build.js"
  cat >"$SUPPORT/update.sh" <<'UPDATE'
#!/bin/bash
# Cart Saver auto-update, run every few minutes by launchd (installed by
# scripts/autoupdate-mac.sh). Arguments: extension folder, log file, git.
set -u
dir="$1"
log="$2"
git="$3"
here="$(cd "$(dirname "$0")" && pwd)"
repo="https://github.com/MilanVeenstra/CardmarketExtension.git"
note() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Keep the log short.
if [ -f "$log" ] && [ "$(wc -l <"$log")" -gt 500 ]; then
  tail -n 300 "$log" >"$log.tmp" && mv "$log.tmp" "$log"
fi

cd "$dir" 2>/dev/null || { note "folder not found: $dir"; exit 0; }
# Only a folder this updater set up, with nothing of your own in it.
[ "$("$git" symbolic-ref --short -q HEAD)" = "cart-saver" ] || { note "skipped: the folder is no longer on the branch cart-saver"; exit 0; }
[ "$("$git" remote get-url origin 2>/dev/null)" = "$repo" ] || { note "skipped: the folder belongs to another repository"; exit 0; }
[ -z "$("$git" status --porcelain)" ] || { note "skipped: the folder has changes of its own"; exit 0; }

"$git" fetch -q origin HEAD 2>/dev/null || exit 0 # offline: next time
new="$("$git" rev-parse FETCH_HEAD)"
[ "$("$git" rev-parse HEAD)" = "$new" ] && exit 0
[ "$(cat "$here/skipped" 2>/dev/null)" = "$new" ] && exit 0 # already found broken

# Check the new version before it replaces the working one.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
"$git" archive FETCH_HEAD | tar -x -C "$tmp"
if ! result="$(/usr/bin/osascript -l JavaScript "$here/check-build.js" "$tmp" 2>&1)"; then
  echo "$new" >"$here/skipped"
  note "version ${new:0:7} skipped, it would not load: $(printf '%s' "$result" | head -c 200)"
  exit 0
fi

"$git" reset -q --hard FETCH_HEAD
# build-id.txt tells the extension which commit is on disk, so every push triggers a reload.
echo "$new" >build-id.txt
note "$("$git" log -1 --format='%h %s')"
UPDATE
  chmod +x "$SUPPORT/update.sh"

  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$SUPPORT/update.sh")</string>
    <string>$(xml_escape "$dir")</string>
    <string>$(xml_escape "$LOG")</string>
    <string>$(xml_escape "$git_bin")</string>
  </array>
  <key>StartInterval</key>
  <integer>$INTERVAL_SECONDS</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG")</string>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"

  echo
  echo "✓ Automatic updates are on."
  echo "  Folder:     $dir"
  echo "  Version:    $("$git_bin" -C "$dir" log -1 --format='%h %s')"
  echo "  Checks:     every $((INTERVAL_SECONDS / 60)) minutes (a version that would not load is skipped)"
  echo
  echo "Now click ↻ once for Cart Saver in chrome://extensions."
  echo "From then on the extension updates itself; refresh open Cardmarket tabs when it asks."
}

status() {
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "✓ Automatic updates are on."
  else
    echo "✗ Automatic updates are off."
  fi
  if [ -f "$LOG" ]; then
    echo "Latest messages:"
    tail -n 5 "$LOG"
  fi
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$SUPPORT"
  echo "✓ Automatic updates are off. The extension itself keeps working."
}

case "${1:-}" in
  install) install "${2:-}" ;;
  status) status ;;
  uninstall) uninstall ;;
  *) usage ;;
esac
