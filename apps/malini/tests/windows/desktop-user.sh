#!/bin/sh
set -eu
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(cygpath -w "$(dirname "$0")/desktop-user.ps1")" "$(cat "/proc/$$/winpid")"
if MSYS_NO_PATHCONV=1 "$(cygpath -S)/whoami.exe" /priv | grep -Eq 'SeBackupPrivilege|SeRestorePrivilege'; then
	echo 'Git Bash still holds the backup and restore privileges, so a locked folder would not stop a test.' >&2
	exit 1
fi
exec "$@"
