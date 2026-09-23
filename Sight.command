#!/bin/bash
# Sight — double-click this file on Mac.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

find_python() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" 2>/dev/null && { command -v python3; return; }
  fi
  for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$HOME/.local/bin/python3"; do
    if [ -x "$p" ]; then
      "$p" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" 2>/dev/null && { echo "$p"; return; }
    fi
  done
  if command -v uv >/dev/null 2>&1; then
    echo "uv"
    return
  fi
  return 1
}

install_python() {
  if command -v brew >/dev/null 2>&1; then
    osascript -e 'display dialog "Sight needs Python. Install it with Homebrew now?" buttons {"Cancel","Install"} default button "Install"' >/dev/null
    brew install python
    return
  fi
  osascript -e 'display dialog "Sight needs Python 3.10+. Download it from python.org, then double-click Sight again." buttons {"Open python.org"} default button 1' >/dev/null || true
  open "https://www.python.org/downloads/"
  exit 1
}

PY="$(find_python || true)"
if [ -z "$PY" ]; then
  install_python
  PY="$(find_python || true)"
fi
if [ -z "$PY" ]; then
  osascript -e 'display dialog "Python is still missing. Install it, then double-click Sight again." buttons {"OK"}' >/dev/null || true
  exit 1
fi

if [ "$PY" = "uv" ]; then
  exec uv run --python 3.12 "$DIR/Sight.py"
fi
exec "$PY" "$DIR/Sight.py"
