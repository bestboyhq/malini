#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
mode=${1:?usage: run.sh unit|e2e|flow|exec [arguments]}
out=${MALINI_LINUX_OUT:-$root/.context/linux/$(date +%Y%m%d-%H%M%S)-$mode}
mkdir -p "$out"
out=$(cd "$out" && pwd)
shift
set -- "$mode" "$@"
mounts=
if [ "$mode" = flow ]; then
	flow=$(cd "$(dirname "${2:?usage: run.sh flow <flow.mjs>}")" && pwd)/$(basename "$2")
	mounts="$(dirname "$flow")"
	set -- flow "$flow"
fi
docker build -q -t malini-linux "$here" >/dev/null
echo "results: $out" >&2
git -C "$root" ls-files -z --cached --others --exclude-standard |
	(cd "$root" && COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs --null -T - -cf -) |
	docker run --rm -i --init --shm-size=2g \
		--security-opt seccomp=unconfined --security-opt apparmor=unconfined \
		--security-opt systempaths=unconfined \
		-v malini-linux-cache:/home/ubuntu/.cache \
		-v malini-linux-pnpm:/home/ubuntu/.local/share/pnpm \
		-v "$out:$root/.context" \
		${mounts:+-v "$mounts:$mounts:ro"} \
		-e ROOT="$root" -e MALINI_THEME="${MALINI_THEME:-dark}" \
		malini-linux "$@"
