import { describe, expect, it } from 'vitest';
import { isSkillNameList } from '$contract/skills';
import { formatTokens, skillPlugin, skillShortName } from './skill-groups';

describe('skill names', () => {
	it('splits a plugin skill into its plugin and short name', () => {
		expect(skillPlugin('ponytail:ponytail-review')).toBe('ponytail');
		expect(skillShortName('ponytail:ponytail-review')).toBe('ponytail-review');
		expect(skillPlugin('adr')).toBeNull();
		expect(skillShortName('adr')).toBe('adr');
	});

	it('counts tokens the way the skill lists show them', () => {
		expect([formatTokens(728), formatTokens(7440), formatTokens(12_400)]).toEqual([
			'728 tok.',
			'7.4k tok.',
			'12k tok.',
		]);
	});

	it('accepts only a list of skill names', () => {
		expect(isSkillNameList(['adr', 'ponytail:ponytail-review'])).toBe(true);
		expect(isSkillNameList([])).toBe(true);
		expect(isSkillNameList([''])).toBe(false);
		expect(isSkillNameList('adr')).toBe(false);
		expect(isSkillNameList(['x'.repeat(201)])).toBe(false);
	});
});
