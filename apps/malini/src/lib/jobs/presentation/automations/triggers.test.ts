import { describe, expect, it } from 'vitest';
import { parseAutomationTrigger } from '$contract/automation-trigger';
import { DEFAULT_JOB_BOUNDARY, type JobDefinitionRecord } from '$contract/jobs';
import {
	jobSentence,
	jobTriggerLook,
	runModeLabel,
	thenChoices,
	triggerFor,
	TRIGGERS,
} from './triggers';

function job(id: string, patch: Partial<JobDefinitionRecord> = {}): JobDefinitionRecord {
	return {
		id,
		name: id,
		instructions: 'Do the thing.',
		model: 'sonnet',
		effort: 'high',
		runsIn: 'workstream',
		skills: [],
		builtin: null,
		trigger: null,
		thenJobId: null,
		boundary: DEFAULT_JOB_BOUNDARY,
		createdAt: '2026-10-23T00:00:00.000Z',
		updatedAt: '2026-10-23T00:00:00.000Z',
		...patch,
	};
}

const MERGED = 'on pull-requests:ship-changed where merged is set';

describe('the trigger picker', () => {
	it('offers only event triggers, besides running it yourself', () => {
		for (const trigger of TRIGGERS) {
			if (trigger.when === null) continue;
			expect(parseAutomationTrigger(trigger.when).kind).toBe('event');
		}
	});

	it('names a merge that stops on conflicts and a new workstream by their events', () => {
		expect(triggerFor('on repositories:workstream-merge-conflicted').label).toBe(
			'A merge stops on conflicts',
		);
		expect(triggerFor('on repositories:workstream-created').label).toBe('A workstream is created');
		expect(triggerFor('on app:updated').label).toBe('Malini updates');
		expect(triggerFor('on chat:agent-event').label).toBe('chat:agent-event');
	});
});

describe('jobSentence', () => {
	it('says when the job runs, where, and which job runs next', () => {
		expect(
			jobSentence(
				job('Changelog', { trigger: { when: MERGED, mode: 'auto' }, thenJobId: 'draft' }),
				'Open draft',
			),
		).toBe(
			'When a pull request merges, Changelog runs in the workstream it fires in and then runs Open draft.',
		);
	});

	it('ends without a next job when there is none, and says how it asks', () => {
		expect(jobSentence(job('Changelog', { trigger: { when: MERGED, mode: 'ask' } }), null)).toBe(
			'When a pull request merges, Changelog runs in the workstream it fires in. It asks you first.',
		);
		expect(jobSentence(job('Changelog', { trigger: { when: MERGED, mode: 'off' } }), null)).toBe(
			'When a pull request merges, Changelog runs in the workstream it fires in. It is off for now.',
		);
		expect(jobSentence(job('Docs', { runsIn: 'new-workstream' }), null)).toBe(
			'When you run it, Docs runs in a new workstream.',
		);
	});

	it('describes a built-in job Malini starts itself', () => {
		expect(
			jobSentence(job('Name chats', { builtin: 'name-chats', name: 'Name chats' }), null),
		).toBe('When you start a chat, Name chats runs in the background.');
	});
});

describe('jobTriggerLook', () => {
	it("reads a job's own trigger, and the fixed one of a built-in", () => {
		expect(jobTriggerLook(job('a', { trigger: { when: MERGED, mode: 'ask' } })).label).toBe(
			'A pull request merges',
		);
		expect(jobTriggerLook(job('a')).label).toBe('When you run it');
		expect(
			jobTriggerLook(
				job('r', {
					builtin: 'resolve-conflicts',
					trigger: { when: 'on repositories:workstream-merge-conflicted', mode: 'auto' },
				}),
			),
		).toMatchObject({ label: 'A merge stops on conflicts', icon: 'swap' });
		expect(jobTriggerLook(job('n', { builtin: 'name-chats' }))).toEqual({
			label: 'You start a chat',
			icon: 'chat',
		});
	});
});

describe('thenChoices', () => {
	it('puts Open draft and Merge first, then every other runnable job by name, never itself', () => {
		const jobs = [
			job('zed'),
			job('merge', { name: 'Merge', builtin: 'merge' }),
			job('names', { name: 'Name chats', builtin: 'name-chats' }),
			job('self', { name: 'Self' }),
			job('fix', { name: 'Fix checks', builtin: 'fix-checks' }),
			job('draft', { name: 'Open draft', builtin: 'open-draft' }),
		];

		expect(thenChoices(jobs, 'self').map((choice) => choice.label)).toEqual([
			'Open draft',
			'Merge',
			'Fix checks',
			'zed',
		]);
	});
});

describe('runModeLabel', () => {
	it('names each run mode the way the switch reads', () => {
		expect([runModeLabel('off'), runModeLabel('ask'), runModeLabel('auto')]).toEqual([
			'Off',
			'Ask me first',
			'On its own',
		]);
	});
});
