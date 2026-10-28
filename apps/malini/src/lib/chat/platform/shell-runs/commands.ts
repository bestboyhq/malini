import { CHAT_SHELL_RUN_CHANGED_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { ShellRuns, type ShellRunsDeps } from './service';

export function installShellRuns(
	context: MainContext,
	deps: Omit<ShellRunsDeps, 'changed'>,
): ShellRuns {
	const { commands, events } = context;
	const shellRuns = new ShellRuns({
		...deps,
		changed: (run) => events.emit(CHAT_SHELL_RUN_CHANGED_CHANNEL, run),
	});

	commands.define('chat.run-shell-command', (args: unknown) =>
		shellRuns.start({
			workstreamId: requireId(args, 'workstreamId'),
			sessionId: requireId(args, 'sessionId'),
			command: requireString(args, 'command'),
		}),
	);
	commands.define('chat.shell-runs', () => shellRuns.list());
	commands.define('chat.write-shell-input', (args: unknown) =>
		shellRuns.write(requireId(args, 'runId'), requireString(args, 'text')),
	);
	commands.define('chat.stop-shell-run', (args: unknown) =>
		shellRuns.stop(requireId(args, 'runId')),
	);
	commands.define('chat.dismiss-shell-run', (args: unknown) =>
		shellRuns.dismiss(requireId(args, 'runId')),
	);
	return shellRuns;
}

function requireString(args: unknown, key: string): string {
	const value = isRecord(args) ? args[key] : undefined;
	if (typeof value !== 'string') throw new Error(`invalid args: \`${key}\` must be a string`);
	return value;
}

function requireId(args: unknown, key: string): string {
	const value = requireString(args, key);
	if (value.length === 0) throw new Error(`invalid args: \`${key}\` must be a non-empty string`);
	return value;
}
