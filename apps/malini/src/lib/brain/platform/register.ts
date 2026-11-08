import type { MainContext } from '$main/context';
import { Brain, type BrainDeps } from './brain.service';

export type BrainPlatform = Readonly<{
	workstream(): Promise<string | null>;
	start(): void;
	dispose(): void;
}>;

export function registerBrain(context: MainContext, deps: BrainDeps): BrainPlatform {
	const { commands } = context;
	const brain = new Brain(context, deps);
	commands.define('brain.status', () => brain.status());
	commands.define('brain.set-up', (args: unknown) => brain.setUp(requireFlag(args, 'sync')));
	commands.define('brain.set-sync', (args: unknown) => brain.setSync(requireFlag(args, 'sync')));
	commands.define('brain.list', () => brain.list());
	commands.define('brain.read', (args: unknown) => brain.read(requireText(args, 'path')));
	commands.define('brain.capture', () => brain.capture());
	return {
		workstream: () => brain.workstream(),
		start: () => brain.start(),
		dispose: () => brain.dispose(),
	};
}

function field(args: unknown, key: string): unknown {
	return typeof args === 'object' && args !== null ? Reflect.get(args, key) : undefined;
}

function requireFlag(args: unknown, key: string): boolean {
	const value = field(args, key);
	if (typeof value !== 'boolean') throw new Error(`invalid args: \`${key}\` must be a boolean`);
	return value;
}

function requireText(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid args: \`${key}\` must be a non-empty string`);
	}
	return value;
}
