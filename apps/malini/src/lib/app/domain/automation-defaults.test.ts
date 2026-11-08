import { describe, expect, it } from 'vitest';
import {
	DEFAULT_AUTOMATION_BOUNDARY,
	type AutomationBuiltin,
	type AutomationDefinitionRecord,
	type AutomationRunMode,
} from '$contract/automations';
import {
	defaultsChoice,
	defaultsTriggerChanges,
	liveDefaults,
	RECOMMENDED,
	scheduleLine,
	updateFromMainMode,
} from './automation-defaults';

const TOUCHES = 'on repositories:workstream-base-overlapped where overlapping is true';
const ALWAYS = 'on repositories:workstream-base-overlapped';

function builtin(
	key: AutomationBuiltin,
	when: string,
	mode: AutomationRunMode,
): AutomationDefinitionRecord {
	return {
		id: key,
		name: key,
		instructions: '',
		provider: 'claude',
		model: 'sonnet',
		effort: 'high',
		runsIn: 'workstream',
		skills: [],
		builtin: key,
		trigger: { when, mode },
		thenAutomationId: null,
		boundary: DEFAULT_AUTOMATION_BOUNDARY,
		createdAt: '2026-11-07T00:00:00.000Z',
		updatedAt: '2026-11-07T00:00:00.000Z',
	};
}

function installed(
	modes: Partial<Record<AutomationBuiltin, AutomationRunMode>> = {},
	updateWhen = TOUCHES,
): AutomationDefinitionRecord[] {
	return [
		builtin(
			'resolve-conflicts',
			'on repositories:workstream-merge-conflicted',
			modes['resolve-conflicts'] ?? 'auto',
		),
		builtin(
			'address-review',
			'on pull-requests:pull-request-changed where reviewDecision is changes_requested',
			modes['address-review'] ?? 'auto',
		),
		builtin('update-from-main', updateWhen, modes['update-from-main'] ?? 'auto'),
		builtin(
			'capture-brain',
			'on repositories:workstream-removed where archived is set',
			modes['capture-brain'] ?? 'auto',
		),
		builtin('write-brain-notes', 'every sunday at 18:00', modes['write-brain-notes'] ?? 'auto'),
	];
}

describe('automation defaults', () => {
	it('reads Update from main from its trigger', () => {
		expect(updateFromMainMode({ when: TOUCHES, mode: 'auto' })).toBe('touches');
		expect(updateFromMainMode({ when: ALWAYS, mode: 'ask' })).toBe('always');
		expect(updateFromMainMode({ when: TOUCHES, mode: 'off' })).toBe('never');
		expect(updateFromMainMode(null)).toBe('never');
	});

	it('calls every default on its own Recommended, and anything else Custom', () => {
		expect(liveDefaults(installed())).toEqual(RECOMMENDED);
		expect(defaultsChoice(installed())).toBe('recommended');
		expect(defaultsChoice(installed({ 'address-review': 'off' }))).toBe('custom');
		expect(defaultsChoice(installed({}, ALWAYS))).toBe('custom');
	});

	it('counts ask as on, but not as Recommended', () => {
		const asking = installed({ 'resolve-conflicts': 'ask' });
		expect(liveDefaults(asking).resolveConflicts).toBe(true);
		expect(defaultsChoice(asking)).toBe('custom');
	});

	it('writes only the triggers a choice changes, and leaves the brain on to its set-up', () => {
		const fresh = installed({ 'capture-brain': 'off', 'write-brain-notes': 'off' });
		expect(defaultsTriggerChanges(fresh, RECOMMENDED)).toEqual([]);

		const changes = defaultsTriggerChanges(installed(), {
			resolveConflicts: true,
			addressReview: false,
			brain: false,
			updateFromMain: 'always',
		});
		expect(
			changes.map(({ definition, trigger }) => [definition.builtin, trigger.mode, trigger.when]),
		).toEqual([
			[
				'address-review',
				'off',
				'on pull-requests:pull-request-changed where reviewDecision is changes_requested',
			],
			['update-from-main', 'auto', ALWAYS],
			['capture-brain', 'off', 'on repositories:workstream-removed where archived is set'],
			['write-brain-notes', 'off', 'every sunday at 18:00'],
		]);
	});

	it('turns Update from main off for Never and back on its filter for Touches my files', () => {
		const never = defaultsTriggerChanges(installed({}, ALWAYS), {
			...RECOMMENDED,
			updateFromMain: 'never',
		});
		expect(never.map(({ trigger }) => trigger)).toEqual([{ when: ALWAYS, mode: 'off' }]);

		const touches = defaultsTriggerChanges(installed({ 'update-from-main': 'off' }, ALWAYS), {
			...RECOMMENDED,
		});
		expect(touches.map(({ trigger }) => trigger)).toEqual([{ when: TOUCHES, mode: 'auto' }]);
	});

	it('says a schedule the way a person reads it', () => {
		expect(scheduleLine('every sunday at 18:00')).toBe('Every Sunday at 18:00');
		expect(scheduleLine('on repositories:workstream-removed')).toBeNull();
	});
});
