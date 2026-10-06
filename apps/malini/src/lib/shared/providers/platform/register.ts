import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLAUDE_SETUP_COMMANDS, type ClaudeSetupStep } from '$contract/agent';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';

export interface ProvidersDeps {
	readonly platform?: NodeJS.Platform;
	readonly openPath?: (path: string) => Promise<string>;
}

export function registerProviders(context: MainContext, deps: ProvidersDeps = {}): void {
	const platform = deps.platform ?? process.platform;
	const openPath = deps.openPath ?? openWithElectron;

	context.commands.define('providers.run-claude-setup', async (args: unknown) => {
		const step = parseStep(args);
		const command = CLAUDE_SETUP_COMMANDS[step];
		if (platform !== 'darwin') {
			throw new Error(`Run \`${command}\` in a terminal, then check again.`);
		}
		const directory = join(context.appDataRoot, 'claude-setup');
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const script = join(directory, `${step}.command`);
		await writeFile(script, `#!/bin/sh\nexport PATH="$HOME/.local/bin:$PATH"\n${command}\n`, {
			mode: 0o700,
		});
		const failure = await openPath(script);
		if (failure.length > 0) throw new Error(`Could not open Terminal: ${failure}`);
	});
}

function parseStep(args: unknown): ClaudeSetupStep {
	const step = isRecord(args) ? args['step'] : undefined;
	if (step === 'install' || step === 'sign-in') return step;
	throw new Error('invalid args: `step` must be `install` or `sign-in`');
}

async function openWithElectron(path: string): Promise<string> {
	const { shell } = await import('electron');
	return shell.openPath(path);
}
