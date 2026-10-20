import { describe, expect, it } from 'vitest';
import type { DiagnosticEntry } from '$contract/diagnostics';
import {
	diagnosticHeadline,
	diagnosticRepeatNote,
	diagnosticSourceLabel,
} from './recent-diagnostics';

function entry(overrides: Partial<DiagnosticEntry>): DiagnosticEntry {
	return {
		occurredAt: '2026-09-23T08:00:00.000Z',
		process: 'main',
		level: 'error',
		source: 'console',
		message: 'base sync skipped',
		detail: null,
		errorName: null,
		code: null,
		command: null,
		durationMs: null,
		suppressedRepeats: 0,
		workstreamId: null,
		viewing: null,
		route: null,
		...overrides,
	};
}

describe('a recent diagnostic row', () => {
	it('names the command a failure came from, and its error and code', () => {
		const failure = entry({
			source: 'ipc-command',
			command: 'repositories.archive-workstream',
			errorName: 'WorkstreamRemovalError',
			code: 'EACCES',
			message: 'permission denied',
		});

		expect(diagnosticSourceLabel(failure)).toBe('ipc-command repositories.archive-workstream');
		expect(diagnosticHeadline(failure)).toBe('WorkstreamRemovalError [EACCES]: permission denied');
		expect(diagnosticSourceLabel(entry({}))).toBe('console');
		expect(diagnosticHeadline(entry({}))).toBe('base sync skipped');
		expect(diagnosticHeadline(entry({ errorName: 'GhError' }))).toBe('GhError: base sync skipped');
	});

	it('counts the identical failures that were not logged', () => {
		expect(diagnosticRepeatNote(entry({}))).toBeNull();
		expect(diagnosticRepeatNote(entry({ suppressedRepeats: 11 }))).toBe(
			'+11 identical not logged before this',
		);
	});
});
