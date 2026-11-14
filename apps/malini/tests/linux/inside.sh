#!/bin/sh
set -eu
if [ "$(id -u)" = 0 ]; then
	mkdir -p "$ROOT"
	chown ubuntu:ubuntu "$ROOT"
	exec setpriv --reuid=ubuntu --regid=ubuntu --init-groups "$0" "$@"
fi
cd "$ROOT"
tar -xf -
pnpm install --frozen-lockfile --store-dir "$HOME/.local/share/pnpm/store"
pnpm --filter 'malini...' build
mode=$1
shift
case $mode in
	unit) exec pnpm --filter malini exec vitest run "$@" ;;
	e2e) set -- pnpm --filter malini exec playwright test --output="$ROOT/.context/test-results" "$@" ;;
	flow) set -- node "$@" ;;
	exec) ;;
	*)
		echo "unknown mode: $mode (unit, e2e, flow or exec)" >&2
		exit 64
		;;
esac
pnpm --filter malini exec install-electron
exec xvfb-run -a -s '-screen 0 1920x1080x24' "$@"
