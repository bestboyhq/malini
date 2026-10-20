export const DIAGNOSTIC_LEVELS = ['error', 'warn', 'info'] as const;

export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];

export type DiagnosticProcess = 'main' | 'renderer';

export interface DiagnosticEntry {
	occurredAt: string;
	process: DiagnosticProcess;
	level: DiagnosticLevel;
	source: string;
	message: string;
	detail: string | null;
	errorName: string | null;
	code: string | null;
	command: string | null;
	durationMs: number | null;
	suppressedRepeats: number;
	workstreamId: string | null;
	viewing: string | null;
	route: string | null;
}

export const TOAST_LEVELS = ['success', 'error', 'warning', 'info', 'loading'] as const;

export type ToastDiagnosticLevel = (typeof TOAST_LEVELS)[number];

export function toastTextIsKept(level: ToastDiagnosticLevel): boolean {
	return level === 'error' || level === 'warning';
}

export interface RendererToastPayload {
	schemaVersion: 1;
	occurredAt: string;
	route: string;
	level: ToastDiagnosticLevel;
	text: string | null;
	workstreamId: string | null;
}

export type ReportToastArgs = Readonly<{ payload: RendererToastPayload }>;

export type RecentDiagnosticsArgs = Readonly<{ limit: number }>;
