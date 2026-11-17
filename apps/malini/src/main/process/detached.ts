import { spawn } from 'node:child_process';
import { describeError } from '$main/errors';
import { spawnable } from './command';

export type DetachedSpawnEnv = Readonly<Record<string, string>>;

export interface DetachedSpawnOutcome {
	readonly launched: boolean;
	readonly error?: string;
}

export function trySpawnDetached(
	command: string,
	args: readonly string[],
	env: DetachedSpawnEnv = {},
): Promise<DetachedSpawnOutcome> {
	return new Promise((resolve) => {
		let child;
		try {
			const environment = { ...process.env, ...env };
			const spawned = spawnable(command, args, environment);
			child = spawn(spawned.file, spawned.args, {
				env: environment,
				detached: true,
				stdio: 'ignore',
				...spawned.options,
			});
		} catch (error) {
			resolve({ launched: false, error: describeError(error) });
			return;
		}
		child.once('error', (error) => resolve({ launched: false, error: error.message }));
		child.once('spawn', () => {
			child.unref();
			resolve({ launched: true });
		});
	});
}
