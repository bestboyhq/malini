export const PERFORMANCE_BUDGETS = Object.freeze({
	navigationCommitMs: 180,
	agentSessionStartMs: 1_500,
	promptAcceptanceMs: 1_000,
	agentCancellationMs: 1_000,
	extensionActivationMs: 2_000,
	repositoryReadMs: 1_500,
	repositoryMutationMs: 4_000,
	mainThreadLagMs: 750,
});

export type RuntimeDiagnosticCategory =
	'navigation' | 'agent' | 'extension' | 'repository' | 'runtime';

export type RuntimeDiagnosticOutcome = 'running' | 'ok' | 'slow' | 'error' | 'cancelled';

export type RuntimeDiagnosticSpan = Readonly<{
	id: number;
	category: RuntimeDiagnosticCategory;
	label: string;
	startedAt: number;
	endedAt: number | null;
	durationMs: number | null;
	budgetMs: number;
	outcome: RuntimeDiagnosticOutcome;
	target?: string;
}>;

export type RuntimeFreezeSample = Readonly<{
	detectedAt: number;
	durationMs: number;
}>;

export type RuntimeDiagnosticHandle = Readonly<{
	id: number;
	finish(): void;
	fail(): void;
	cancel(): void;
}>;

type StartSpanInput = Readonly<{
	category: RuntimeDiagnosticCategory;
	label: string;
	budgetMs: number;
	target?: string;
}>;

type WatchdogOptions = Readonly<{
	intervalMs?: number;
	lagThresholdMs?: number;
	isVisible?: () => boolean;
}>;

const MAX_RECENT_SPANS = 80;
const MAX_FREEZE_SAMPLES = 20;
const MAX_ACTIVE_SPANS = 40;
const MAX_DIAGNOSTIC_LABEL_LENGTH = 120;
const MAX_DIAGNOSTIC_TARGET_LENGTH = 256;
const DEFAULT_WATCHDOG_INTERVAL_MS = 250;

export class RuntimeDiagnostics {
	active = $state<RuntimeDiagnosticSpan[]>([]);
	recent = $state<RuntimeDiagnosticSpan[]>([]);
	freezes = $state<RuntimeFreezeSample[]>([]);

	#nextId = 0;
	#navigationHandle: RuntimeDiagnosticHandle | null = null;
	#navigationTarget: string | null = null;
	#watchdog: ReturnType<typeof setInterval> | null = null;
	#now: () => number;

	constructor(now: () => number = monotonicNow) {
		this.#now = now;
	}

	start(input: StartSpanInput): RuntimeDiagnosticHandle {
		while (this.active.length >= MAX_ACTIVE_SPANS) {
			const oldest = this.active[0];
			if (!oldest) break;
			this.#close(oldest.id, 'cancelled');
		}
		const span: RuntimeDiagnosticSpan = {
			id: ++this.#nextId,
			category: input.category,
			label: boundedDiagnosticText(input.label, 'Operation', MAX_DIAGNOSTIC_LABEL_LENGTH),
			startedAt: this.#now(),
			endedAt: null,
			durationMs: null,
			budgetMs: input.budgetMs,
			outcome: 'running',
			...(input.target
				? {
						target: boundedDiagnosticText(input.target, 'unknown', MAX_DIAGNOSTIC_TARGET_LENGTH),
					}
				: {}),
		};
		this.active = [...this.active, span];
		let closed = false;
		const close = (outcome: Exclude<RuntimeDiagnosticOutcome, 'running'>): void => {
			if (closed) return;
			closed = true;
			this.#close(span.id, outcome);
		};
		return {
			id: span.id,
			finish: () => close('ok'),
			fail: () => close('error'),
			cancel: () => close('cancelled'),
		};
	}

	async measure<T>(input: StartSpanInput, operation: () => Promise<T>): Promise<T> {
		const handle = this.start(input);
		try {
			const value = await operation();
			handle.finish();
			return value;
		} catch (error) {
			handle.fail();
			throw error;
		}
	}

	beginNavigation(target: string, label: string): RuntimeDiagnosticHandle {
		this.#navigationHandle?.cancel();
		const normalizedTarget = normalizePath(target);
		const handle = this.start({
			category: 'navigation',
			label,
			budgetMs: PERFORMANCE_BUDGETS.navigationCommitMs,
			target: publicNavigationTarget(normalizedTarget),
		});
		this.#navigationHandle = handle;
		this.#navigationTarget = normalizedTarget;
		return handle;
	}

	completeNavigation(currentPath: string): void {
		if (!this.#navigationHandle || !this.#navigationTarget) return;
		if (normalizePath(currentPath) !== this.#navigationTarget) return;
		this.#navigationHandle.finish();
		this.#navigationHandle = null;
		this.#navigationTarget = null;
	}

	installMainThreadWatchdog(options: WatchdogOptions = {}): () => void {
		this.stopMainThreadWatchdog();
		const intervalMs = positiveFiniteInterval(options.intervalMs, DEFAULT_WATCHDOG_INTERVAL_MS);
		const lagThresholdMs = positiveFiniteInterval(
			options.lagThresholdMs,
			PERFORMANCE_BUDGETS.mainThreadLagMs,
		);
		const isVisible =
			options.isVisible ?? (() => globalThis.document?.visibilityState !== 'hidden');
		let expectedAt = this.#now() + intervalMs;
		const watchdog = setInterval(() => {
			const now = this.#now();
			const lag = Math.max(0, now - expectedAt);
			expectedAt = now + intervalMs;
			if (!isVisible() || lag < lagThresholdMs) return;
			this.freezes = [...this.freezes, { detectedAt: now, durationMs: Math.round(lag) }].slice(
				-MAX_FREEZE_SAMPLES,
			);
		}, intervalMs);
		this.#watchdog = watchdog;
		return () => {
			if (this.#watchdog !== watchdog) return;
			clearInterval(watchdog);
			this.#watchdog = null;
		};
	}

	stopMainThreadWatchdog(): void {
		if (this.#watchdog !== null) clearInterval(this.#watchdog);
		this.#watchdog = null;
	}

	snapshot(): Readonly<{
		active: readonly RuntimeDiagnosticSpan[];
		recent: readonly RuntimeDiagnosticSpan[];
		freezes: readonly RuntimeFreezeSample[];
	}> {
		return {
			active: this.active.map((span) => ({ ...span })),
			recent: this.recent.map((span) => ({ ...span })),
			freezes: this.freezes.map((sample) => ({ ...sample })),
		};
	}

	reset(): void {
		this.stopMainThreadWatchdog();
		this.#navigationHandle = null;
		this.#navigationTarget = null;
		this.active = [];
		this.recent = [];
		this.freezes = [];
	}

	#close(id: number, requestedOutcome: Exclude<RuntimeDiagnosticOutcome, 'running'>): void {
		const span = this.active.find((candidate) => candidate.id === id);
		if (!span) return;
		const endedAt = this.#now();
		const durationMs = Math.max(0, endedAt - span.startedAt);
		const outcome =
			requestedOutcome === 'ok' && durationMs > span.budgetMs ? 'slow' : requestedOutcome;
		const completed = { ...span, endedAt, durationMs, outcome } satisfies RuntimeDiagnosticSpan;
		this.active = this.active.filter((candidate) => candidate.id !== id);
		this.recent = [...this.recent, completed].slice(-MAX_RECENT_SPANS);
	}
}

export function monotonicNow(): number {
	return globalThis.performance?.now?.() ?? Date.now();
}

function normalizePath(value: string): string {
	try {
		const url = new URL(value, 'https://malini.local');
		return `${url.pathname}${url.search}`;
	} catch {
		return value;
	}
}

function publicNavigationTarget(value: string): string {
	return value.split(/[?#]/u, 1)[0] || '/';
}

function boundedDiagnosticText(value: string, fallback: string, maxLength: number): string {
	const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim() || fallback;
	return normalized.slice(0, maxLength);
}

function positiveFiniteInterval(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.max(1, Math.trunc(value))
		: fallback;
}

export const runtimeDiagnostics = new RuntimeDiagnostics();

declare global {
	interface Window {
		__MALINI_RUNTIME_DIAGNOSTICS__?: () => ReturnType<RuntimeDiagnostics['snapshot']>;
	}
}

export function exposeRuntimeDiagnostics(): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const read = (): ReturnType<RuntimeDiagnostics['snapshot']> => runtimeDiagnostics.snapshot();
	window.__MALINI_RUNTIME_DIAGNOSTICS__ = read;
	return () => {
		if (window.__MALINI_RUNTIME_DIAGNOSTICS__ === read) {
			delete window.__MALINI_RUNTIME_DIAGNOSTICS__;
		}
	};
}
