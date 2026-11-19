import { app, powerMonitor, type BrowserWindow } from 'electron';
import { cpus, totalmem } from 'node:os';
import type { MainContext } from '$main/context';
import type { CommandRegistry } from '$main/ipc/registry';
import { listOpenRuns } from '$lib/chat/chat.platform';

export interface ErrorMoment {
	readonly chip: string | null;
	readonly memoryBytes: number;
	readonly gpu: 'hardware' | 'software' | null;
	readonly upMs: number;
	readonly sinceWakeMs: number | null;
	readonly usedBytes: number | null;
	readonly runs: number | null;
	readonly screen: string | null;
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
const GIB = 2 ** 30;

export function errorContextLine(moment: ErrorMoment, trail: readonly string[]): string {
	return [
		[moment.chip, `${Math.round(moment.memoryBytes / GIB)} GB`].filter(Boolean).join(' '),
		moment.gpu && `gpu ${moment.gpu}`,
		`up ${elapsed(moment.upMs)}`,
		moment.sinceWakeMs !== null && `wake ${elapsed(moment.sinceWakeMs)}`,
		moment.usedBytes !== null && `uses ${(moment.usedBytes / GIB).toFixed(1)} GB`,
		moment.runs !== null && `runs ${moment.runs}`,
		moment.screen && `on ${moment.screen}`,
		trail.length > 0 && `after ${trail.join(', ')}`,
	]
		.filter(Boolean)
		.join(' · ');
}

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
	let wokeAt: number | null = null;
	powerMonitor.on('resume', () => {
		wokeAt = Date.now();
	});
	return () => ({
		chip: cpus()[0]?.model.trim() || null,
		memoryBytes: totalmem(),
		gpu: app.getGPUFeatureStatus().gpu_compositing.startsWith('enabled') ? 'hardware' : 'software',
		upMs: process.uptime() * 1000,
		sinceWakeMs: wokeAt === null ? null : Date.now() - wokeAt,
		usedBytes:
			app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) * 1024,
		runs: openRuns(context),
		screen: screenShown(mainWindow()),
	});
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

function elapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 120) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 120) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
