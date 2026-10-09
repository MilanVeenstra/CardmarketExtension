#!/bin/bash
#
# Keep an unpacked Cart Saver install up to date with GitHub (macOS).
#
#   ./autoupdate-mac.sh install "/pad/naar/de/extensiemap"
#   ./autoupdate-mac.sh status
#   ./autoupdate-mac.sh uninstall
#
# `install` turns the folder Chrome loads the extension from into a git
# checkout of the repository's main branch (in place, so Chrome keeps the same extension and
# your saved data), and registers a small background job (launchd) that
# fetches the latest version every few minutes. The extension notices new
# files by itself and reloads; open Cardmarket tabs then ask for a refresh.
#
# Nothing is sent anywhere: the job only downloads from the public repository.

set -euo pipefail

REPO_URL="https://github.com/MilanVeenstra/CardmarketExtension.git"
# The repository's default branch: `fetch origin HEAD` follows it, whatever it is called.
LOCAL_BRANCH="cart-saver"
LABEL="com.cardmarket-cart-saver.autoupdate"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/cart-saver-autoupdate.log"
INTERVAL_SECONDS=180

usage() {
  cat <<EOF
Gebruik:
  $0 install "/pad/naar/de/extensiemap"   automatisch bijwerken aanzetten
  $0 status                                 laatste updates bekijken
  $0 uninstall                              automatisch bijwerken uitzetten
EOF
  exit 1
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

install() {
  local dir="${1:-}"
  [ -n "$dir" ] || usage

  local git_bin
  git_bin="$(command -v git || true)"
  if [ -z "$git_bin" ]; then
    echo "git ontbreekt. Installeer het eerst met:  xcode-select --install" >&2
    exit 1
  fi

  mkdir -p "$dir"
  dir="$(cd "$dir" && pwd)"
  if [ ! -d "$dir/.git" ]; then
    if [ -n "$(ls -A "$dir")" ] && [ ! -f "$dir/manifest.json" ]; then
      echo "$dir is niet leeg en bevat geen manifest.json. Kies de map waaruit Chrome de extensie laadt." >&2
      exit 1
    fi
    "$git_bin" -C "$dir" init -q
    "$git_bin" -C "$dir" remote add origin "$REPO_URL"
  fi
  echo "Nieuwste versie ophalen…"
  "$git_bin" -C "$dir" fetch -q origin HEAD
  "$git_bin" -C "$dir" checkout -q -f -B "$LOCAL_BRANCH" FETCH_HEAD
  "$git_bin" -C "$dir" rev-parse HEAD >"$dir/build-id.txt"

  # The job: fetch and move to the latest commit. This folder is only a
  # deployment copy, so a hard reset is the robust choice.
  local quoted_dir="'${dir//\'/\'\\\'\'}'"
  # build-id.txt tells the extension which commit is on disk, so every push
  # triggers a reload (the file is ignored by git).
  local command="cd $quoted_dir && '$git_bin' fetch -q origin HEAD && '$git_bin' reset -q --hard FETCH_HEAD && new=\$('$git_bin' rev-parse HEAD) && if [ \"\$new\" != \"\$(cat build-id.txt 2>/dev/null)\" ]; then echo \"\$new\" > build-id.txt && echo \"\$(date '+%Y-%m-%d %H:%M:%S') \$('$git_bin' log -1 --format='%h %s')\"; fi"

  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>$(xml_escape "$command")</string>
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
  echo "✓ Automatisch bijwerken staat aan."
  echo "  Map:        $dir"
  echo "  Versie:     $("$git_bin" -C "$dir" log -1 --format='%h %s')"
  echo "  Controle:   elke $((INTERVAL_SECONDS / 60)) minuten"
  echo
  echo "Klik nu één keer op ↻ bij Cart Saver in chrome://extensions."
  echo "Daarna werkt de extensie zichzelf bij; ververs open Cardmarket-tabbladen als daarom gevraagd wordt."
}

status() {
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "✓ Automatisch bijwerken staat aan."
  else
    echo "✗ Automatisch bijwerken staat uit."
  fi
  if [ -f "$LOG" ]; then
    echo "Laatste updates:"
    tail -n 5 "$LOG"
  fi
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ Automatisch bijwerken staat uit. De extensie zelf blijft gewoon werken."
}

case "${1:-}" in
  install) install "${2:-}" ;;
  status) status ;;
  uninstall) uninstall ;;
  *) usage ;;
esac
