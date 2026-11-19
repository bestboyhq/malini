import { app, type BrowserWindow } from 'electron';
import type { MainContext } from '$main/context';
import type { CommandRegistry } from '$main/ipc/registry';
import { listOpenRuns } from '$lib/chat/chat.platform';

export interface ErrorMoment {
	readonly running_for: string;
	readonly memory_used: string;
	readonly rendering: 'gpu' | 'software';
	readonly screen: string | null;
	readonly agent_runs: number | null;
}

export interface CommandTrail {
	names(): readonly string[];
	stop(): void;
}

const TRAIL_LENGTH = 6;
const SCREENS: ReadonlySet<string> = new Set([
	'workstreams',
	'repositories',
	'automations',
	'brain',
	'dev',
]);
export function commandTrail(commands: Pick<CommandRegistry, 'observeStarts'>): CommandTrail {
	const recent: string[] = [];
	const stop = commands.observeStarts(({ command }) => {
		const seen = recent.indexOf(command);
		if (seen !== -1) recent.splice(seen, 1);
		recent.unshift(command);
		recent.length = Math.min(recent.length, TRAIL_LENGTH);
	});
	return { names: () => [...recent], stop };
}

export function electronErrorMoment(
	context: Pick<MainContext, 'db'>,
	mainWindow: () => BrowserWindow | null,
): () => ErrorMoment {
	return () => ({
		running_for: elapsed(process.uptime()),
		memory_used: gigabytes(
			app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) * 1024,
			1,
		),
		rendering: app.getGPUFeatureStatus().gpu_compositing.startsWith('enabled') ? 'gpu' : 'software',
		screen: screenShown(mainWindow()),
		agent_runs: openRuns(context),
	});
}

export function gigabytes(bytes: number, digits: number): string {
	return `${(bytes / 2 ** 30).toFixed(digits)} GB`;
}

export function elapsed(seconds: number): string {
	const whole = Math.floor(seconds);
	if (whole < 120) return `${whole}s`;
	const minutes = Math.floor(whole / 60);
	if (minutes < 120) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function openRuns(context: Pick<MainContext, 'db'>): number | null {
	try {
		return listOpenRuns(context.db).length;
	} catch {
		return null;
	}
}

function screenShown(window: BrowserWindow | null): string | null {
	if (!window || window.isDestroyed()) return null;
	const url = URL.parse(window.webContents.getURL());
	if (url === null) return null;
	const segment = url.hash.split('/')[1] ?? '';
	if (segment === '') return 'home';
	return SCREENS.has(segment) ? segment : 'other';
}
