import { describe, expect, it } from 'vitest';
import {
	DEFAULT_AUTOMATION_BOUNDARY,
	type AutomationBoundary,
	type AutomationDefinitionRecord,
} from '$contract/automations';
import { canLeak, seesYourWords } from './automation-boundary';

function automation(
	id: string,
	boundary: Partial<AutomationBoundary> = {},
	changes: Partial<AutomationDefinitionRecord> = {},
): AutomationDefinitionRecord {
	return {
		id,
		name: id,
		instructions: `Do ${id}.`,
		provider: 'claude',
		model: 'opus',
		effort: 'high',
		runsIn: 'workstream',
		skills: [],
		builtin: null,
		trigger: null,
		thenAutomationId: null,
		boundary: { ...DEFAULT_AUTOMATION_BOUNDARY, ...boundary },
		createdAt: '2026-11-01T00:00:00.000Z',
		updatedAt: '2026-11-01T00:00:00.000Z',
		...changes,
	};
}

describe('an automation that can leak your words', () => {
	it('sees your words through a chat, an attachment, a whole event or the automation before it', () => {
		const recall = automation('recall', { chats: 'all', before: false });
		const notes = automation('notes', { before: true });
		const automations = [{ ...recall, thenAutomationId: 'notes' }, notes];

		expect(seesYourWords(automation('docs'), [])).toBe(false);
		expect(seesYourWords(automation('docs', { attachments: true }), [])).toBe(true);
		expect(seesYourWords(automation('docs', { event: 'full' }), [])).toBe(false);
		expect(
			seesYourWords(
				automation(
					'docs',
					{ event: 'full' },
					{ trigger: { when: 'on chat:turn-finished', mode: 'auto' } },
				),
				[],
			),
		).toBe(true);
		expect(seesYourWords(notes, automations)).toBe(true);
		expect(
			seesYourWords({ ...notes, boundary: { ...notes.boundary, before: false } }, automations),
		).toBe(false);
	});

	it('leaks once it reaches the internet or a Then that publishes, and never loops on a cycle', () => {
		const draft = automation('draft', {}, { builtin: 'open-draft' });
		const sealed = automation('sealed', { chats: 'starter', internet: false });
		const publishing = { ...sealed, thenAutomationId: 'draft' };
		const a = automation('a', { before: true }, { thenAutomationId: 'b' });
		const b = automation('b', { before: true }, { thenAutomationId: 'a' });

		expect(canLeak(sealed, [sealed, draft])).toBe(false);
		expect(canLeak(publishing, [publishing, draft])).toBe(true);
		expect(canLeak(automation('open', { chats: 'all' }), [])).toBe(true);
		expect(canLeak(a, [a, b])).toBe(false);
	});
});
