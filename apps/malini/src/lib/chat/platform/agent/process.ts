import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface BridgeSpawnSpec {
	readonly scriptPath: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd?: string;
}

export interface BridgeProcess {
	readonly pid: number;
	readonly stdin: Writable;
	readonly stdout: Readable;
	readonly stderr: Readable | null;
	readonly leadsProcessGroup: boolean;
	kill(signal: 'SIGTERM' | 'SIGKILL'): void;
	onExit(listener: (code: number | null) => void): void;
	exited(): boolean;
}

export interface BridgeProcessFactory {
	spawn(spec: BridgeSpawnSpec): Promise<BridgeProcess>;
}

export interface NodeProcessFactoryOptions {
	readonly binary?: string;
	readonly extraEnv?: Readonly<Record<string, string>>;
}

export function createNodeProcessFactory(
	options: NodeProcessFactoryOptions = {},
): BridgeProcessFactory {
	const binary = options.binary ?? process.execPath;
	const extraEnv = options.extraEnv ?? {};
	return {
		spawn(spec) {
			return new Promise((resolve, reject) => {
				const child = spawn(binary, [spec.scriptPath, ...spec.args], {
					env: { ...spec.env, ...extraEnv },
					...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
					stdio: ['pipe', 'pipe', 'pipe'],
					detached: true,
				});
				let exited = false;
				let exitCode: number | null = null;
				const exitListeners: Array<(code: number | null) => void> = [];
				const settleExit = (code: number | null): void => {
					if (exited) return;
					exited = true;
					exitCode = code;
					for (const listener of exitListeners.splice(0)) listener(code);
				};
				child.once('error', (error) => {
					reject(error);
					settleExit(null);
				});
				child.once('exit', (code) => settleExit(code));
				child.once('spawn', () => {
					const pid = child.pid;
					if (pid === undefined || !child.stdin || !child.stdout) {
						reject(new Error('bridge child spawned without pipes'));
						return;
					}
					resolve({
						pid,
						stdin: child.stdin,
						stdout: child.stdout,
						stderr: child.stderr,
						leadsProcessGroup: true,
						kill(signal) {
							child.kill(signal);
						},
						onExit(listener) {
							if (exited) listener(exitCode);
							else exitListeners.push(listener);
						},
						exited: () => exited,
					});
				});
			});
		},
	};
}

export function createElectronNodeProcessFactory(): BridgeProcessFactory {
	return createNodeProcessFactory({ extraEnv: { ELECTRON_RUN_AS_NODE: '1' } });
}
