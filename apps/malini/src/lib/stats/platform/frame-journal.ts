import type { FrameKind, FrameScript, RendererFrame } from '$contract/stats';
import { isRecord } from '$main/db/rows';
import { sanitizeDiagnosticText, sanitizeRoute } from '$main/diagnostics/redaction';
import { droppedFrames, JANK_MS } from '../domain/frames';
import type { BrowserTab } from './resource-sampler';

export const STALL_PROBE_MS = 20;
export const MAX_ENTRIES_PER_MINUTE = 120;
export const MAX_FRAMES_PER_REPORT = 64;
export const MAX_SCRIPTS_PER_FRAME = 5;

const MINUTE_MS = 60_000;
const MAX_DURATION_MS = 60_000;
const SCRIPT_TEXT_CHARS = 200;
const FALLBACK_DISPLAY_HZ = 60;

export type FrameJournalEntry = Readonly<{
	schemaVersion: 1;
	occurredAt: string;
	process: 'renderer' | 'main';
	kind: FrameKind | 'stall';
	durationMs: number;
	cpuMs: number | null;
	droppedFrames: number;
	displayHz: number;
	focused: boolean;
	route: string | null;
	browser: Readonly<{ open: number; shown: number }>;
	layoutMs: number | null;
	blockingMs: number | null;
	scripts: readonly FrameScript[];
	suppressedBefore: number;
}>;

export interface FrameJournalDeps {
	write(entry: FrameJournalEntry): void;
	browserTabs(): readonly BrowserTab[];
	displayHz(): number;
	now?(): number;
}

type JournaledFrame = Omit<RendererFrame, 'kind' | 'route'> &
	Readonly<Pick<FrameJournalEntry, 'process' | 'kind' | 'route' | 'cpuMs'>>;

export class FrameJournal {
	readonly #deps: FrameJournalDeps;
	#probe: ReturnType<typeof setInterval> | null = null;
	#budgetStartedAt = Number.NEGATIVE_INFINITY;
	#written = 0;
	#suppressed = 0;

	constructor(deps: FrameJournalDeps) {
		this.#deps = deps;
	}

	recordRendererFrames(args: unknown): void {
		for (const frame of rendererFrames(args)) {
			this.#record({ ...frame, process: 'renderer', cpuMs: null });
		}
	}

	watchStalls(): void {
		if (this.#probe) return;
		let probedAt = performance.now();
		let cpu = process.threadCpuUsage();
		// ponytail: a 20 ms timer reads a stall up to 20 ms short and wakes the main thread 50 times a second while focused; a native watchdog thread reads it exactly.
		this.#probe = setInterval(() => {
			const now = performance.now();
			const lateMs = now - probedAt - STALL_PROBE_MS;
			const cpuNow = process.threadCpuUsage();
			const cpuMs = (cpuNow.user - cpu.user + cpuNow.system - cpu.system) / 1_000;
			probedAt = now;
			cpu = cpuNow;
			if (lateMs < JANK_MS) return;
			this.#record({
				process: 'main',
				kind: 'stall',
				startedAt: this.#now() - lateMs,
				durationMs: lateMs,
				cpuMs,
				focused: true,
				route: null,
				layoutMs: null,
				blockingMs: null,
				scripts: [],
			});
		}, STALL_PROBE_MS);
		this.#probe.unref();
	}

	stopWatchingStalls(): void {
		if (this.#probe) clearInterval(this.#probe);
		this.#probe = null;
	}

	#record(frame: JournaledFrame): void {
		if (!this.#claimSlot()) return;
		const reportedHz = Math.round(this.#deps.displayHz());
		const displayHz = reportedHz > 0 ? reportedHz : FALLBACK_DISPLAY_HZ;
		const tabs = this.#deps.browserTabs();
		this.#deps.write({
			schemaVersion: 1,
			occurredAt: new Date(frame.startedAt).toISOString(),
			process: frame.process,
			kind: frame.kind,
			durationMs: Math.round(frame.durationMs),
			cpuMs: roundedOrNull(frame.cpuMs),
			droppedFrames: droppedFrames(frame.durationMs, displayHz),
			displayHz,
			focused: frame.focused,
			route: frame.route,
			browser: { open: tabs.length, shown: tabs.filter((tab) => tab.shown).length },
			layoutMs: roundedOrNull(frame.layoutMs),
			blockingMs: roundedOrNull(frame.blockingMs),
			scripts: frame.scripts,
			suppressedBefore: this.#suppressed,
		});
		this.#suppressed = 0;
	}

	#claimSlot(): boolean {
		const now = this.#now();
		if (now - this.#budgetStartedAt >= MINUTE_MS) {
			this.#budgetStartedAt = now;
			this.#written = 0;
		}
		if (this.#written >= MAX_ENTRIES_PER_MINUTE) {
			this.#suppressed += 1;
			return false;
		}
		this.#written += 1;
		return true;
	}

	#now(): number {
		return this.#deps.now?.() ?? Date.now();
	}
}

export function rendererFrames(args: unknown): RendererFrame[] {
	const frames = isRecord(args) ? args['frames'] : undefined;
	if (!Array.isArray(frames)) throw new Error('invalid args: `frames` must be an array');
	return frames.slice(0, MAX_FRAMES_PER_REPORT).flatMap((frame) => rendererFrame(frame) ?? []);
}

function rendererFrame(value: unknown): RendererFrame | null {
	if (!isRecord(value)) return null;
	const { kind, startedAt, durationMs, focused, route, layoutMs, blockingMs, scripts } = value;
	if (kind !== 'long-frame' && kind !== 'frame-gap') return null;
	if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null;
	if (!isDuration(durationMs) || typeof focused !== 'boolean' || typeof route !== 'string') {
		return null;
	}
	if (!isDurationOrNull(layoutMs) || !isDurationOrNull(blockingMs) || !Array.isArray(scripts)) {
		return null;
	}
	return {
		kind,
		startedAt,
		durationMs,
		focused,
		route: sanitizeRoute(route),
		layoutMs,
		blockingMs,
		scripts: scripts.slice(0, MAX_SCRIPTS_PER_FRAME).flatMap((script) => frameScript(script) ?? []),
	};
}

function frameScript(value: unknown): FrameScript | null {
	if (!isRecord(value)) return null;
	const { invoker, source, durationMs, forcedLayoutMs } = value;
	if (typeof invoker !== 'string' || typeof source !== 'string') return null;
	if (!isDuration(durationMs) || !isDuration(forcedLayoutMs)) return null;
	return {
		invoker: scriptText(invoker),
		source: scriptText(source),
		durationMs: Math.round(durationMs),
		forcedLayoutMs: Math.round(forcedLayoutMs),
	};
}

function scriptText(text: string): string {
	return sanitizeDiagnosticText(text, SCRIPT_TEXT_CHARS, false, 'unknown');
}

function isDuration(value: unknown): value is number {
	return (
		typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_MS
	);
}

function isDurationOrNull(value: unknown): value is number | null {
	return value === null || isDuration(value);
}

function roundedOrNull(value: number | null): number | null {
	return value === null ? null : Math.round(value);
}
