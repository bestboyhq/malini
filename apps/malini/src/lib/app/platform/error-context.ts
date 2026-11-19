import { app, powerMonitor, type BrowserWindow } from 'electron';
import type { MainContext } from '$main/context';
import type { CommandRegistry } from '$main/ipc/registry';
import { listOpenRuns } from '$lib/chat/chat.platform';

export interface ErrorMoment {
	readonly open_screen: string | null;
	readonly open_agent_runs: number | null;
	readonly malini_rendering: 'gpu' | 'software';
	readonly malini_memory_used_mb: number;
	readonly seconds_since_malini_started: number;
	readonly seconds_since_mac_woke: number | null;
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
	let wokeAt: number | null = null;
	powerMonitor.on('resume', () => {
		wokeAt = Date.now();
	});
	return () => ({
		open_screen: screenShown(mainWindow()),
		open_agent_runs: openRuns(context),
		malini_rendering: app.getGPUFeatureStatus().gpu_compositing.startsWith('enabled')
			? 'gpu'
			: 'software',
		malini_memory_used_mb: Math.round(
			app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024,
		),
		seconds_since_malini_started: Math.round(process.uptime()),
		seconds_since_mac_woke: wokeAt === null ? null : Math.round((Date.now() - wokeAt) / 1000),
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
