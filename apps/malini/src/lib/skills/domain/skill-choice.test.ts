import { describe, expect, it } from 'vitest';
import type { SkillRecord } from '$contract/skills';
import { isSkillChoice, resolveSkillChoice } from './skill-choice';
import { formatTokens, groupSkills, skillShortName } from './skill-groups';

describe('choosing skills', () => {
	it('gives a run its preset, and every skill when the preset is gone', () => {
		const builder = {
			id: 'builder',
			name: 'Builder',
			emoji: null,
			skills: ['adr'],
			createdAt: '2026-10-15T00:00:00Z',
			updatedAt: '2026-10-15T00:00:00Z',
		};
		expect(resolveSkillChoice({ kind: 'preset', presetId: 'builder' }, [builder])).toEqual({
			skills: ['adr'],
			preset: builder,
		});
		expect(resolveSkillChoice({ kind: 'preset', presetId: 'gone' }, [builder]).skills).toBe('all');
		expect(resolveSkillChoice({ kind: 'default' }, [builder]).skills).toBe('all');
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
			'728 tok.',
			'7.4k tok.',
			'12k tok.',
		]);
	});
});
