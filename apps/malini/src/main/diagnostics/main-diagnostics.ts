import type { CommandFailure } from '../../contract/ipc';
import type { FailedCommand } from '../ipc/registry';
import { workstreamIdOf } from '../ipc/command-failure';
import { MAIN_LOG_STEM } from './diagnostics-files';
import { appendNdjsonRecord } from './ndjson-log';
import { redactSensitiveText, sanitizeDiagnosticText } from './redaction';
import { thrownDetail } from './thrown';

export const MAIN_DIAGNOSTICS_SCHEMA_VERSION = 1;
export const MAX_RECORDS_PER_WINDOW = 100;
export const RECORD_WINDOW_MS = 10_000;
export const REPEAT_WINDOW_MS = 5 * 60_000;
const MAX_TRACKED_REPEATS = 512;
const MAX_MESSAGE_CHARS = 2_048;
const MAX_NAME_CHARS = 80;
const MAX_CODE_CHARS = 80;
const MAX_STACK_CHARS = 8_192;
const MAX_DETAIL_CHARS = 1_024;

export type MainDiagnosticLevel = 'error' | 'warn' | 'info';

export type MainDiagnosticSource =
	| 'ipc-command'
	| 'console'
	| 'process-warning'
	| 'uncaught-exception'
	| 'unhandled-rejection'
	| 'diagnostics';

export interface MainDiagnosticEvent {
	readonly level: MainDiagnosticLevel;
	readonly source: MainDiagnosticSource;
	readonly message: string;
	readonly error?: unknown;
	readonly command?: string;
	readonly workstreamId?: string | null;
	readonly durationMs?: number;
	readonly suppressedRepeats?: number;
}

export interface DiagnosticsRuntime {
	readonly productName: string;
	readonly bundleIdentifier: string;
	readonly version: string;
	readonly pid: number;
}

export interface MainDiagnosticsOptions {
	readonly appDataRoot: string;
	readonly runtime: DiagnosticsRuntime;
	readonly now?: () => Date;
	readonly home?: string;
	readonly reportWriteFailure?: (message: string) => void;
}

interface MainErrorDetail {
	readonly name: string;
	readonly code: string | null;
	readonly kind: string | null;
	readonly message: string;
	readonly detail: string | null;
	readonly stack: string | null;
}

export class MainDiagnosticsLog {
	readonly #options: MainDiagnosticsOptions;
	readonly #budgets = new Map<RecordBudget, BudgetWindow>();
	readonly #repeats = new Map<string, RepeatWindow>();
	#writeFailureReported = false;

	constructor(options: MainDiagnosticsOptions) {
		this.#options = options;
	}

	record(event: MainDiagnosticEvent): void {
		try {
			const occurredAt = this.#now();
			if (!this.#claimSlot(budgetOf(event.level), occurredAt.getTime())) return;
			this.#write(occurredAt, event);
		} catch (error) {
			this.#reportWriteFailure(error);
		}
	}

	recordCommandFailure(failed: FailedCommand): void {
		const suppressedRepeats = this.#claimRepeat(failed);
		if (suppressedRepeats === null) return;
		this.record({
			level: commandFailureLevel(failed.failure),
			source: 'ipc-command',
			message: failed.failure.message,
			error: failed.error,
			command: failed.command,
			workstreamId: workstreamIdOf(failed.args),
			durationMs: failed.durationMs,
			suppressedRepeats,
		});
	}

	#claimRepeat(failed: FailedCommand): number | null {
		const now = this.#now().getTime();
		const key = [failed.command, failed.failure.name, failed.failure.message].join('\u0000');
		const previous = this.#repeats.get(key);
		if (previous && now >= previous.recordedAt && now - previous.recordedAt < REPEAT_WINDOW_MS) {
			previous.suppressed += 1;
			return null;
		}
		this.#forgetStaleRepeats(now);
		this.#repeats.set(key, { recordedAt: now, suppressed: 0 });
		return previous?.suppressed ?? 0;
	}

	#forgetStaleRepeats(now: number): void {
		if (this.#repeats.size < MAX_TRACKED_REPEATS) return;
		for (const [key, window] of this.#repeats) {
			if (now - window.recordedAt >= REPEAT_WINDOW_MS) this.#repeats.delete(key);
		}
		if (this.#repeats.size >= MAX_TRACKED_REPEATS) this.#repeats.clear();
	}

	#claimSlot(budget: RecordBudget, timestamp: number): boolean {
		const window = this.#budgets.get(budget) ?? {
			startedAt: Number.NEGATIVE_INFINITY,
			used: 0,
			dropped: 0,
		};
		this.#budgets.set(budget, window);
		if (timestamp - window.startedAt >= RECORD_WINDOW_MS || timestamp < window.startedAt) {
			const dropped = window.dropped;
			window.startedAt = timestamp;
			window.used = 0;
			window.dropped = 0;
			if (dropped > 0) this.#noteDropped(window, dropped);
		}
		if (window.used >= MAX_RECORDS_PER_WINDOW) {
			window.dropped += 1;
			return false;
		}
		window.used += 1;
		return true;
	}

	#noteDropped(window: BudgetWindow, dropped: number): void {
		window.used += 1;
		this.#write(this.#now(), {
			level: 'warn',
			source: 'diagnostics',
			message: `${dropped} main-process diagnostics were dropped: more than ${MAX_RECORDS_PER_WINDOW} in ${RECORD_WINDOW_MS / 1000}s`,
		});
	}

	#write(occurredAt: Date, event: MainDiagnosticEvent): void {
		const home = this.#options.home;
		const record = {
			schemaVersion: MAIN_DIAGNOSTICS_SCHEMA_VERSION,
			occurredAt: occurredAt.toISOString(),
			level: event.level,
			source: event.source,
			message: sanitizeDiagnosticText(event.message, MAX_MESSAGE_CHARS, false, event.source, home),
			command: event.command ?? null,
			workstreamId: event.workstreamId ?? null,
			durationMs: event.durationMs ?? null,
			suppressedRepeats: event.suppressedRepeats ?? 0,
			error: event.error === undefined ? null : errorDetail(event.error, home),
			runtime: this.#options.runtime,
		};
		appendNdjsonRecord(this.#options.appDataRoot, MAIN_LOG_STEM, record);
	}

	#reportWriteFailure(error: unknown): void {
		if (this.#writeFailureReported) return;
		this.#writeFailureReported = true;
		const report =
			this.#options.reportWriteFailure ??
			((message: string) => process.stderr.write(`${message}\n`));
		report(
			`malini: the main-process diagnostics log is not writable: ${thrownDetail(error).reason}`,
		);
	}

	#now(): Date {
		return this.#options.now?.() ?? new Date();
	}
}

type RecordBudget = 'problems' | 'info';

interface BudgetWindow {
	startedAt: number;
	used: number;
	dropped: number;
}

interface RepeatWindow {
	readonly recordedAt: number;
	suppressed: number;
}

function budgetOf(level: MainDiagnosticLevel): RecordBudget {
	return level === 'info' ? 'info' : 'problems';
}

const EXPECTED_FAILURE_KINDS: Readonly<Record<string, ReadonlySet<string>>> = {
	GhError: new Set(['auth-required', 'not-installed']),
	LifecycleError: new Set(['already_running', 'cancel_race']),
};

export function commandFailureLevel(failure: CommandFailure): MainDiagnosticLevel {
	return failure.kind !== null && EXPECTED_FAILURE_KINDS[failure.name]?.has(failure.kind)
		? 'warn'
		: 'error';
}

function errorDetail(error: unknown, home: string | undefined): MainErrorDetail {
	const detail = thrownDetail(error);
	return {
		name: sanitizeDiagnosticText(detail.name, MAX_NAME_CHARS, false, 'Error', home),
		code: detail.code === null ? null : boundedText(detail.code, MAX_CODE_CHARS, home),
		kind: detail.kind === null ? null : boundedText(detail.kind, MAX_CODE_CHARS, home),
		message: sanitizeDiagnosticText(
			detail.reason || `no reason given, threw ${detail.shape}`,
			MAX_MESSAGE_CHARS,
			false,
			'Error',
			home,
		),
		detail:
			detail.detail === null
				? null
				: sanitizeDiagnosticText(detail.detail, MAX_DETAIL_CHARS, true, '', home) || null,
		stack:
			detail.stack === null
				? null
				: sanitizeDiagnosticText(detail.stack, MAX_STACK_CHARS, true, '', home) || null,
	};
}

function boundedText(value: string, maximum: number, home: string | undefined): string {
	return [...redactSensitiveText(value, home)].slice(0, maximum).join('');
}
