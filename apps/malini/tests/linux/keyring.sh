#!/bin/sh
set -eu
if [ -z "${MALINI_E2E_KEYRING:-}" ]; then
	MALINI_E2E_KEYRING=1 exec dbus-run-session -- sh "$0" "$@"
fi
keyrings=$(mktemp -d)
printf malini-e2e | XDG_DATA_HOME="$keyrings" gnome-keyring-daemon --unlock --components=secrets >/dev/null
status=0
"$@" || status=$?
rm -rf "$keyrings"
exit "$status"
