import { describe, expect, it } from 'vitest';
import type { SkillPresetRecord } from '$contract/skills';
import { offeredSuggestions } from './skill-suggestions';

const WRITER = { name: 'Writer', skills: ['humanizer', 'landing-arch'] };
const BUILDER = { name: 'Builder', skills: ['adr', 'run'] };

describe('offeredSuggestions', () => {
	it('offers nothing while Claude is still suggesting', () => {
		expect(offeredSuggestions('loading', [], [])).toEqual({ suggesting: true, offered: [] });
	});

	it('hides a suggestion once a preset carries its name, whatever the case', () => {
		expect(offeredSuggestions('ready', [WRITER, BUILDER], [preset('builder')])).toEqual({
			suggesting: false,
			offered: [WRITER],
		});
	});

	it('falls back to blank Builder and Marketer when Claude suggests nothing', () => {
		expect(offeredSuggestions('error', [], []).offered.map(({ name }) => name)).toEqual([
			'Builder',
			'Marketer',
		]);
		expect(offeredSuggestions('ready', [], []).offered).toHaveLength(2);
	});
});

function preset(name: string): SkillPresetRecord {
	return { id: name, name, skills: [], isDefault: false, createdAt: '', updatedAt: '' };
}
