import { describe, expect, it } from 'vitest';
import { parseAutomationTrigger, unknownTriggerValueMessage } from '$contract/automation-trigger';
import {
	DEFAULT_AUTOMATION_BOUNDARY,
	type AutomationDefinitionRecord,
} from '$contract/automations';
import {
	automationSentence,
	automationTriggerLook,
	runModeLabel,
	thenChoices,
	triggerFor,
	TRIGGERS,
} from './triggers';

function automation(
	id: string,
	patch: Partial<AutomationDefinitionRecord> = {},
): AutomationDefinitionRecord {
	return {
		id,
		name: id,
		instructions: 'Do the thing.',
		provider: 'claude',
		model: 'sonnet',
		effort: 'high',
		runsIn: 'workstream',
		skills: [],
		builtin: null,
		trigger: null,
		thenAutomationId: null,
		boundary: DEFAULT_AUTOMATION_BOUNDARY,
		createdAt: '2026-10-23T00:00:00.000Z',
		updatedAt: '2026-10-23T00:00:00.000Z',
		...patch,
	};
}

const MERGED = 'on pull-requests:ship-changed where merged is set';

describe('the trigger picker', () => {
	it('offers only event triggers on states their events report, besides running it yourself', () => {
		for (const trigger of TRIGGERS) {
			if (trigger.when === null) continue;
			const parsed = parseAutomationTrigger(trigger.when);
			expect(parsed.kind).toBe('event');
			expect(unknownTriggerValueMessage(parsed)).toBeNull();
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

describe('automationSentence', () => {
	it('says when the automation runs, where, and which automation runs next', () => {
		expect(
			automationSentence(
				automation('Changelog', {
					trigger: { when: MERGED, mode: 'auto' },
					thenAutomationId: 'draft',
				}),
				'Open draft',
			),
		).toBe(
			'When a pull request merges, Changelog runs in the workstream it fires in and then runs Open draft.',
		);
	});

	it('ends without a next automation when there is none, and says how it asks', () => {
		expect(
			automationSentence(automation('Changelog', { trigger: { when: MERGED, mode: 'ask' } }), null),
		).toBe(
			'When a pull request merges, Changelog runs in the workstream it fires in. It asks you first.',
		);
		expect(
			automationSentence(automation('Changelog', { trigger: { when: MERGED, mode: 'off' } }), null),
		).toBe(
			'When a pull request merges, Changelog runs in the workstream it fires in. It is off for now.',
		);
		expect(automationSentence(automation('Docs', { runsIn: 'new-workstream' }), null)).toBe(
			'When you run it, Docs runs in a new workstream.',
		);
	});

	it('describes a built-in automation Malini starts itself', () => {
		expect(
			automationSentence(
				automation('Name chats', { builtin: 'name-chats', name: 'Name chats' }),
				null,
			),
		).toBe('When you start a chat, Name chats runs in the background.');
	});
});

describe('automationTriggerLook', () => {
	it("reads an automation's own trigger, and the fixed one of a built-in", () => {
		expect(
			automationTriggerLook(automation('a', { trigger: { when: MERGED, mode: 'ask' } })).label,
		).toBe('A pull request merges');
		expect(automationTriggerLook(automation('a')).label).toBe('When you run it');
		expect(
			automationTriggerLook(
				automation('r', {
					builtin: 'resolve-conflicts',
					trigger: { when: 'on repositories:workstream-merge-conflicted', mode: 'auto' },
				}),
			),
		).toMatchObject({ label: 'A merge stops on conflicts', icon: 'swap' });
		expect(automationTriggerLook(automation('n', { builtin: 'name-chats' }))).toEqual({
			label: 'You start a chat',
			icon: 'chat',
		});
	});
});

describe('thenChoices', () => {
	it('puts Open draft and Merge first, then every other runnable automation by name, never itself', () => {
		const automations = [
			automation('zed'),
			automation('merge', { name: 'Merge', builtin: 'merge' }),
			automation('names', { name: 'Name chats', builtin: 'name-chats' }),
			automation('self', { name: 'Self' }),
			automation('fix', { name: 'Fix checks', builtin: 'fix-checks' }),
			automation('draft', { name: 'Open draft', builtin: 'open-draft' }),
		];

		expect(thenChoices(automations, 'self').map((choice) => choice.label)).toEqual([
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
