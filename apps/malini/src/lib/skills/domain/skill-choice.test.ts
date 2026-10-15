import { describe, expect, it } from 'vitest';
import type { SkillRecord } from '$contract/skills';
import { isSkillChoice, toggleSkill } from './skill-choice';
import { formatTokens, groupSkills, skillShortName } from './skill-groups';

describe('choosing skills', () => {
	it('turns every skill into a list without the one switched off, and adds one back', () => {
		expect(toggleSkill('all', ['adr', 'animate', 'dataviz'], 'animate')).toEqual([
			'adr',
			'dataviz',
		]);
		expect(toggleSkill(['adr'], ['adr', 'animate'], 'animate')).toEqual(['adr', 'animate']);
		expect(toggleSkill(['adr', 'animate'], ['adr', 'animate'], 'adr')).toEqual(['animate']);
	});

	it('accepts only the choices malini knows', () => {
		expect(isSkillChoice({ kind: 'preset', presetId: 'builder' })).toBe(true);
		expect(isSkillChoice({ kind: 'custom', skills: ['adr'] })).toBe(true);
		expect(isSkillChoice({ kind: 'preset', presetId: '' })).toBe(false);
		expect(isSkillChoice({ kind: 'custom', skills: [''] })).toBe(false);
		expect(isSkillChoice({ kind: 'everything' })).toBe(false);
	});

	it('groups skills by where they come from, the repository first', () => {
		const skill = (name: string, source: SkillRecord['source']): SkillRecord => ({
			name,
			description: '',
			source,
			tokens: 1,
		});
		const groups = groupSkills([
			skill('dataviz', 'claude-code'),
			skill('animate', 'personal'),
			skill('adr', 'repository'),
		]);

		expect(groups.map(({ label }) => label)).toEqual([
			'Repository',
			'Personal',
			'Built into Claude Code',
		]);
		expect(skillShortName('ponytail:ponytail-review')).toBe('ponytail-review');
		expect([formatTokens(728), formatTokens(7440), formatTokens(12_400)]).toEqual([
			'728 tokens',
			'7.4k tokens',
			'12k tokens',
		]);
	});
});
