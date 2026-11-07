import { describe, expect, it } from 'vitest';
import type { BrainEntry } from '$contract/brain';
import {
	brainBody,
	brainLogDays,
	brainSync,
	brainSyncLine,
	brainTopics,
	defaultBrainPath,
	linkedLogDays,
	rewrittenLine,
	wikiLinkPath,
} from './brain';

function entry(path: string, title = path): BrainEntry {
	return { path, kind: path.startsWith('log/') ? 'log' : 'note', title, updatedAt: null };
}

const ENTRIES = [
	entry('notes/products/malini.md', 'Malini'),
	entry('notes/lessons.md', 'Lessons'),
	entry('notes/products/grip.md', 'Grip'),
	entry('notes/open-questions.md', 'Open questions'),
	entry('log/2026-11-05.md'),
	entry('log/2026-11-06.md'),
];

describe('brain', () => {
	it('groups notes by their first folder and lists log days newest first', () => {
		expect(
			brainTopics(ENTRIES).map(({ title, entry, children }) => [
				title,
				entry?.path ?? null,
				children.map((child) => child.title),
			]),
		).toEqual([
			['Lessons', 'notes/lessons.md', []],
			['Open questions', 'notes/open-questions.md', []],
			['Products', null, ['Grip', 'Malini']],
		]);
		expect(brainLogDays(ENTRIES).map(({ day, label }) => [day, label])).toEqual([
			['2026-11-06', 'Nov 6, 2026'],
			['2026-11-05', 'Nov 5, 2026'],
		]);
		expect(defaultBrainPath(ENTRIES)).toBe('notes/lessons.md');
		expect(defaultBrainPath([entry('log/2026-11-06.md')])).toBeNull();
	});

	it('resolves wiki links to log days and notes', () => {
		expect(wikiLinkPath('log/2026-11-06', ENTRIES)).toBe('log/2026-11-06.md');
		expect(wikiLinkPath('malini', ENTRIES)).toBe('notes/products/malini.md');
		expect(wikiLinkPath('log/2026-01-01', ENTRIES)).toBe('log/2026-01-01.md');
		expect(wikiLinkPath('nowhere', ENTRIES)).toBeNull();
	});

	it('reads the log days a note links and drops its title from the body', () => {
		const text =
			'# Lessons\n\nSee [[log/2026-11-06]] and [[log/2026-11-05|the day before]], [[log/2026-11-06]].';
		expect(linkedLogDays(text)).toEqual(['log/2026-11-06', 'log/2026-11-05']);
		expect(brainBody(text).startsWith('See')).toBe(true);
		expect(rewrittenLine('2026-11-06T12:00:00.000Z', 2)).toBe('Rewritten Nov 6 from 2 log days');
		expect(rewrittenLine(null, 2)).toBeNull();
	});

	it('says where the brain syncs', () => {
		const status = {
			set: true,
			repository: 'szymeo/brain',
			sync: true,
			workstreamId: 'w',
			location: '/brain',
			syncedAt: '2026-11-07T11:58:00.000Z',
			unpushed: 0,
			problem: null,
		};
		const now = Date.parse('2026-11-07T12:00:00.000Z');
		expect(brainSyncLine(brainSync(status), now)).toBe('Synced to szymeo/brain, 2 minutes ago');
		expect(brainSyncLine(brainSync({ ...status, unpushed: 3 }), now)).toBe(
			'3 changes wait to push',
		);
		expect(brainSyncLine(brainSync({ ...status, sync: false }), now)).toBe('On this Mac');
		expect(brainSyncLine(brainSync({ ...status, problem: 'Push denied' }), now)).toBe(
			'Push denied',
		);
	});
});
