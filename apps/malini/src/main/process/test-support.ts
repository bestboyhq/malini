import type { ProcessExit, ProcessHandle, ProcessRunner, ProcessSpawnOptions } from './runner';

export interface RecordedSpawn {
	readonly file: string;
	readonly args: readonly string[];
	readonly cwd: string | undefined;
	readonly env: Readonly<Record<string, string>> | undefined;
	readonly process: FakeProcess;
}

export class FakeProcess implements ProcessHandle {
	readonly pid: number | null;
	readonly exit: Promise<ProcessExit>;
	readonly signals: NodeJS.Signals[] = [];
	private settle!: (exit: ProcessExit) => void;
	private ended = false;
	stubborn = false;

	constructor(
		pid: number | null,
		private readonly options: ProcessSpawnOptions,
		private readonly runner: ScriptedRunner,
	) {
		this.pid = pid;
		this.exit = new Promise((resolve) => {
			this.settle = resolve;
		});
	}

	get alive(): boolean {
		return !this.ended;
	}

	stdout(text: string): void {
		this.options.onStdout?.(text);
	}

	stderr(text: string): void {
		this.options.onStderr?.(text);
	}

	end(exit: ProcessExit): void {
		if (this.ended) return;
		this.ended = true;
		if (this.pid !== null) this.runner.aliveGroups.delete(this.pid);
		this.settle(exit);
	}

	exitWith(code: number): void {
		this.end({ kind: 'exited', code });
	}

	signal(signal: NodeJS.Signals): void {
		this.signals.push(signal);
		if (signal === 'SIGKILL' || (signal === 'SIGTERM' && !this.stubborn)) {
			this.end({ kind: 'signaled', signal });
		}
	}
}

export type ScriptedBehavior =
	| {
			readonly kind: 'exit';
			readonly code: number;
			readonly stdout?: string;
			readonly stderr?: string;
	  }
	| { readonly kind: 'hang' }
	| { readonly kind: 'spawn-failure'; readonly error: string }
	| { readonly kind: 'manual' };

export type SpawnMatcher = (file: string, args: readonly string[]) => boolean;

export class ScriptedRunner implements ProcessRunner {
	readonly spawns: RecordedSpawn[] = [];
	readonly aliveGroups = new Set<number>();
	readonly groupSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
	readonly alivePids = new Set<number>();
	private nextPid = 40_000;
	private readonly scripts: Array<{ match: SpawnMatcher; behavior: ScriptedBehavior }> = [];

	on(match: SpawnMatcher, behavior: ScriptedBehavior): this {
		this.scripts.push({ match, behavior });
		return this;
	}

	onCommand(name: string, prefix: readonly string[] = [], behavior: ScriptedBehavior): this {
		return this.on(
			(file, args) =>
				(file === name || file.endsWith(`/${name}`)) &&
				prefix.every((part, index) => args[index] === part),
			behavior,
		);
	}

	spawn(file: string, args: readonly string[], options: ProcessSpawnOptions = {}): ProcessHandle {
		const script = this.scripts.find((candidate) => candidate.match(file, args));
		if (!script) throw new Error(`unscripted spawn: ${file} ${args.join(' ')}`);
		const behavior = script.behavior;
		const pid = behavior.kind === 'spawn-failure' ? null : (this.nextPid += 1);
		const process = new FakeProcess(pid, options, this);
		if (pid !== null) this.aliveGroups.add(pid);
		this.spawns.push({ file, args, cwd: options.cwd, env: options.env, process });
		switch (behavior.kind) {
			case 'spawn-failure':
				queueMicrotask(() => process.end({ kind: 'failed', error: behavior.error }));
				break;
			case 'exit':
				queueMicrotask(() => {
					if (behavior.stdout) process.stdout(behavior.stdout);
					if (behavior.stderr) process.stderr(behavior.stderr);
					process.exitWith(behavior.code);
				});
				break;
			case 'hang':
			case 'manual':
				break;
		}
		return process;
	}

	signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
		this.groupSignals.push({ pid, signal });
		this.spawns.find((spawn) => spawn.process.pid === pid)?.process.signal(signal);
	}

	processGroupIsAlive(pid: number): boolean {
		return this.aliveGroups.has(pid);
	}

	processIsAlive(pid: number): boolean {
		return this.aliveGroups.has(pid) || this.alivePids.has(pid);
	}

	last(name: string): RecordedSpawn {
		const found = [...this.spawns]
			.reverse()
			.find((spawn) => spawn.file === name || spawn.file.endsWith(`/${name}`));
		if (!found) throw new Error(`no spawn of ${name} recorded`);
		return found;
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
		await sleep(5);
	}
}
