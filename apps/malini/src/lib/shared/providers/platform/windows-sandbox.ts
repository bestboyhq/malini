import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	SANDBOX_RUNTIME,
	removeWindowsSandbox,
	setUpWindowsSandbox,
	windows,
	type WindowsSetupOutcome,
} from '@malini/agent-bridge/sandbox/windows';
import type { SandboxSetupOutcome } from '$contract/agent';
import { PROVIDERS_SANDBOX_SETUP_PROGRESS_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';

const RUNTIME = join('node_modules', '@anthropic-ai', 'sandbox-runtime');
const WINDOWS_ONLY: WindowsSetupOutcome = {
	outcome: 'failed',
	reason: 'Malini sets up its sandbox only on Windows',
};

export function registerWindowsSandbox(context: MainContext, platform: NodeJS.Platform): void {
	const windowsHost = platform === 'win32';
	const root = [
		join(context.resourcesRoot, 'agent-bridge', RUNTIME),
		join(context.resourcesRoot, '..', '..', 'packages', 'agent-bridge', 'dist', RUNTIME),
	].find((folder) => existsSync(join(folder, 'package.json')));
	if (windowsHost && root !== undefined) process.env[SANDBOX_RUNTIME] ??= root;

	const answer = async (work: () => Promise<WindowsSetupOutcome>): Promise<SandboxSetupOutcome> => {
		const done = windowsHost ? await work() : WINDOWS_ONLY;
		return {
			outcome: done.outcome,
			reason: done.outcome === 'failed' ? done.reason : null,
			problem: windowsHost ? windows.problem() : null,
		};
	};

	context.commands.define('providers.set-up-sandbox', (args: unknown) =>
		answer(() =>
			setUpWindowsSandbox(isRecord(args) && args['replace'] === true, (received, total) =>
				context.events.emit(PROVIDERS_SANDBOX_SETUP_PROGRESS_CHANNEL, { received, total }),
			),
		),
	);

	context.commands.define('providers.remove-sandbox', () => answer(removeWindowsSandbox));
}
