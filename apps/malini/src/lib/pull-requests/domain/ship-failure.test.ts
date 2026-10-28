import { describe, expect, it } from 'vitest';
import type { ShipStep } from '$contract/pull-requests';
import {
	codeSpans,
	failureNextTry,
	failureTries,
	shipFailure,
	type ShipFailureSource,
} from './ship-failure';

describe('shipFailure', () => {
	it('tells what failed, why, how often, since when and when Malini tries again', () => {
		expect(shipFailure(ship())).toEqual({
			stage: 'draft',
			label: "Couldn't open draft",
			title: "Malini couldn't open the draft",
			reason: 'GitHub refused the push: needs the workflow scope.',
			githubSaid: 'refusing to allow an OAuth App to create or update workflow',
			tries: 5,
			since: '23:06',
			nextTry: '23:22',
		});
	});

	it('is quiet while nothing fails, and leaves stops to needs you', () => {
		expect(shipFailure(null)).toBeNull();
		expect(shipFailure(ship({ failures: 0 }))).toBeNull();
		expect(shipFailure(ship({ lastError: null }))).toBeNull();
		expect(shipFailure(ship({ phase: 'local' }))).toBeNull();
		expect(shipFailure(ship({ phase: 'needs-you' }))).toBeNull();
	});

	it.each<[ShipFailureSource['phase'], ShipStep | null, number | null, string, string]>([
		['draft', 'opening-draft', null, "Couldn't open draft", "Malini couldn't open the draft"],
		[
			'queued',
			'opening-draft',
			null,
			"Couldn't open pull request",
			"Malini couldn't open the pull request",
		],
		['draft', 'pushing', 7, "Couldn't push", "Malini couldn't push"],
		[
			'queued',
			'marking-ready',
			7,
			"Couldn't mark ready",
			"Malini couldn't mark the pull request ready",
		],
		['queued', 'updating-branch', 7, "Couldn't update branch", "Malini couldn't update the branch"],
		['queued', 'merging', 7, "Couldn't merge", "Malini couldn't merge"],
		['queued', 'archiving', 7, "Couldn't archive", "Malini couldn't archive the workstream"],
		['queued', 'waiting-for-github', 7, "Couldn't merge", "Malini couldn't merge"],
		['draft', null, null, "Couldn't open draft", "Malini couldn't open the draft"],
		['draft', null, 7, "Couldn't push", "Malini couldn't push"],
	])('names a %s that failed at %s (pull request %s)', (phase, step, number, label, title) => {
		expect(shipFailure(ship({ phase, step, pullRequestNumber: number }))).toMatchObject({
			stage: phase === 'queued' ? 'merge' : 'draft',
			label,
			title,
		});
	});

	it('counts from the last change when it never recorded the first failure', () => {
		expect(
			shipFailure(ship({ failedSince: null, updatedAt: localTime(9, 5), nextAttemptAt: null })),
		).toMatchObject({ since: '09:05', nextTry: null });
	});
});

describe('failure copy', () => {
	it('counts tries and says when the next one comes', () => {
		const failure = shipFailure(ship({ failures: 1 }));
		const now = shipFailure(ship({ nextAttemptAt: null }));
		if (!failure || !now) throw new Error('both ships are failing');
		expect(failureTries(failure)).toBe('1 try');
		expect(failureTries(now)).toBe('5 tries');
		expect(failureNextTry(failure)).toBe('next at 23:22');
		expect(failureNextTry(now)).toBe('retrying now');
	});

	it('splits a reason into text and the code it quotes', () => {
		expect(codeSpans('Run `gh auth refresh -s workflow` once, then retry.')).toEqual([
			{ text: 'Run ', code: false },
			{ text: 'gh auth refresh -s workflow', code: true },
			{ text: ' once, then retry.', code: false },
		]);
		expect(codeSpans('No code, and a lone ` tick')).toEqual([
			{ text: 'No code, and a lone ` tick', code: false },
		]);
	});
});

function ship(overrides: Partial<ShipFailureSource> = {}): ShipFailureSource {
	return {
		phase: 'draft',
		step: 'opening-draft',
		pullRequestNumber: null,
		lastError: 'GitHub refused the push: needs the workflow scope.',
		githubSaid: 'refusing to allow an OAuth App to create or update workflow',
		failures: 5,
		failedSince: localTime(23, 6),
		nextAttemptAt: localTime(23, 22),
		updatedAt: localTime(23, 14),
		...overrides,
	};
}

function localTime(hour: number, minute: number): string {
	return new Date(2026, 9, 27, hour, minute).toISOString();
}
