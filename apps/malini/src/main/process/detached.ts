import { spawn } from 'node:child_process';
import { describeError } from '$main/errors';

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
			child = spawn(command, [...args], {
				env: { ...process.env, ...env },
				detached: true,
				stdio: 'ignore',
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
