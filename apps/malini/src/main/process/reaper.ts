import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import type { App } from 'electron';

const LAUNCHER_CHECK_MS = 1_000;
const REAPER_CHECK_S = 5;
const ORPHAN_QUIT_DEADLINE_S = 15;
const TERMINATE_GRACE_TENTHS = 30;

const REAPER_SCRIPT = `
malini=$PPID launcher=$1 check=$2 deadline=$3 grace=$4
groups= orphaned= checked=$SECONDS
parent_of() { ps -o ppid= -p "$1" 2>/dev/null | tr -d ' '; }
[ -n "$launcher" ] && [ "$(ps -o pgid= -p "$malini" 2>/dev/null | tr -d ' ')" = "$malini" ] && groups=$malini
keep_living() {
	living=
	for group in $groups; do kill -0 -"$group" 2>/dev/null && living="$living $group"; done
	groups=$living
}
stop_hung_malini() {
	[ "$(parent_of $$)" = "$malini" ] || return
	kill -KILL -"$malini" 2>/dev/null || kill -KILL "$malini" 2>/dev/null
}
while :; do
	reading_since=$SECONDS
	if read -r -t "$check" line; then
		case $line in '' | *[!0-9]*) ;; *) groups="$groups $line" ;; esac
	elif [ $((SECONDS - reading_since)) -lt $((check - 1)) ]; then
		break
	fi
	[ $((SECONDS - checked)) -ge "$check" ] || continue
	checked=$SECONDS
	keep_living
	[ -n "$launcher" ] || continue
	if [ -z "$orphaned" ]; then
		parent=$(parent_of "$malini")
		[ -n "$parent" ] && [ "$parent" != "$launcher" ] && orphaned=$SECONDS
	elif [ $((SECONDS - orphaned)) -ge "$deadline" ]; then
		stop_hung_malini
	fi
done
keep_living
for group in $groups; do kill -TERM -"$group" 2>/dev/null; done
waited=0
while keep_living; [ -n "$groups" ] && [ "$waited" -lt "$grace" ]; do
	sleep 0.1
	waited=$((waited + 1))
done
for group in $groups; do kill -KILL -"$group" 2>/dev/null; done
`;

let reaper: Writable | null = null;

export function startReaper(app: App, options: { readonly watchLauncher: boolean }): void {
	const launcher = process.ppid;
	if (options.watchLauncher) quitOnceTheLauncherIsGone(app, launcher);
	if (process.platform === 'win32') return;
	const child = spawn(
		'/bin/bash',
		[
			'-c',
			REAPER_SCRIPT,
			'malini-reaper',
			options.watchLauncher ? String(launcher) : '',
			String(REAPER_CHECK_S),
			String(ORPHAN_QUIT_DEADLINE_S),
			String(TERMINATE_GRACE_TENTHS),
		],
		{ stdio: ['pipe', 'ignore', 'ignore'], detached: true },
	);
	child.once('error', (error) => {
		reaper = null;
		console.error(`malini: the reaper did not start: ${error.message}`);
	});
	// ponytail: a reaper that dies is not started again, so a later crash leaves processes behind; keep the pids and start a new one if that happens
	child.once('exit', (code, signal) => {
		reaper = null;
		console.error(`malini: the reaper stopped with ${signal ?? code}`);
	});
	child.stdin.on('error', () => {
		reaper = null;
	});
	child.unref();
	reaper = child.stdin;
}

export function endWithMalini<Child extends { readonly pid?: number | undefined }>(
	child: Child,
): Child {
	if (child.pid !== undefined) reaper?.write(`${child.pid}\n`);
	return child;
}

function quitOnceTheLauncherIsGone(app: App, launcher: number): void {
	const check = setInterval(() => {
		if (process.ppid === launcher) return;
		clearInterval(check);
		app.quit();
	}, LAUNCHER_CHECK_MS);
}
