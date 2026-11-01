import { describe, expect, it } from 'vitest';
import { DEFAULT_JOB_BOUNDARY, type JobBoundary, type JobDefinitionRecord } from '$contract/jobs';
import { canLeak, seesYourWords } from './job-boundary';

function job(
	id: string,
	boundary: Partial<JobBoundary> = {},
	changes: Partial<JobDefinitionRecord> = {},
): JobDefinitionRecord {
	return {
		id,
		name: id,
		instructions: `Do ${id}.`,
		model: 'opus',
		effort: 'high',
		runsIn: 'workstream',
		skills: [],
		builtin: null,
		trigger: null,
		thenJobId: null,
		boundary: { ...DEFAULT_JOB_BOUNDARY, ...boundary },
		createdAt: '2026-11-01T00:00:00.000Z',
		updatedAt: '2026-11-01T00:00:00.000Z',
		...changes,
	};
}

describe('a job that can leak your words', () => {
	it('sees your words through a chat, an attachment, a whole event or the job before it', () => {
		const recall = job('recall', { chats: 'all', before: false });
		const notes = job('notes', { before: true });
		const jobs = [{ ...recall, thenJobId: 'notes' }, notes];

		expect(seesYourWords(job('docs'), [])).toBe(false);
		expect(seesYourWords(job('docs', { attachments: true }), [])).toBe(true);
		expect(seesYourWords(job('docs', { event: 'full' }), [])).toBe(false);
		expect(
			seesYourWords(
				job(
					'docs',
					{ event: 'full' },
					{ trigger: { when: 'on chat:turn-finished', mode: 'auto' } },
				),
				[],
			),
		).toBe(true);
		expect(seesYourWords(notes, jobs)).toBe(true);
		expect(seesYourWords({ ...notes, boundary: { ...notes.boundary, before: false } }, jobs)).toBe(
			false,
		);
	});

	it('leaks once it reaches the internet or a Then that publishes, and never loops on a cycle', () => {
		const draft = job('draft', {}, { builtin: 'open-draft' });
		const sealed = job('sealed', { chats: 'starter', internet: false });
		const publishing = { ...sealed, thenJobId: 'draft' };
		const a = job('a', { before: true }, { thenJobId: 'b' });
		const b = job('b', { before: true }, { thenJobId: 'a' });

		expect(canLeak(sealed, [sealed, draft])).toBe(false);
		expect(canLeak(publishing, [publishing, draft])).toBe(true);
		expect(canLeak(job('open', { chats: 'all' }), [])).toBe(true);
		expect(canLeak(a, [a, b])).toBe(false);
	});
});
