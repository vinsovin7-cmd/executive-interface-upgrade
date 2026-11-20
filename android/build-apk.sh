#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  printf 'Usage: bash android/build-apk.sh [https://your-deployed-app.example]\n' >&2
  exit 2
fi

APP_URL="${1:-https://executive-interface-upgrade.vercel.app}"
export APP_URL

python3 - <<'PY'
import os
import sys
from urllib.parse import urlparse

url = urlparse(os.environ["APP_URL"])
if (
    url.scheme != "https"
    or not url.hostname
    or url.username
    or url.password
    or url.query
    or url.fragment
):
    sys.exit("APP_URL must be a public HTTPS URL without credentials, query parameters, or a fragment.")
PY

ANDROID_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gradle --project-dir "$ANDROID_DIR" --no-daemon --console=plain -PappUrl="$APP_URL" :app:assembleDebug
