import type { DiagnosticEntry } from '$contract/diagnostics';

export const RECENT_DIAGNOSTICS_LIMIT = 50;

export type RecentDiagnostics = Readonly<{
	entries: readonly DiagnosticEntry[] | null;
	failure: string | null;
}>;

export function diagnosticSourceLabel(entry: DiagnosticEntry): string {
	return entry.command === null ? entry.source : `${entry.source} ${entry.command}`;
}

export function diagnosticHeadline(entry: DiagnosticEntry): string {
	if (entry.errorName === null) return entry.message;
	const code = entry.code === null ? '' : ` [${entry.code}]`;
	return `${entry.errorName}${code}: ${entry.message}`;
}

export function diagnosticRepeatNote(entry: DiagnosticEntry): string | null {
	if (entry.suppressedRepeats === 0) return null;
	return `+${entry.suppressedRepeats} identical not logged before this`;
}
