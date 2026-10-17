import { describe, expect, it } from 'vitest';
import type { SkillRecord, SkillUsageReport } from '$contract/skills';
import {
	lastUsedLabel,
	skillHeat,
	skillIsOn,
	skillUsageOrigin,
	skillUsageRows,
	skillUsageSummary,
	switchedReport,
} from './skill-usage';

const skill = (name: string, source: SkillRecord['source'], tokens: number): SkillRecord => ({
	name,
	description: `${name} does things`,
	source,
	tokens,
});

const CATALOG: readonly SkillRecord[] = [
	{ ...skill('adr', 'repository', 120), repositories: ['malini', 'gardener-game'] },
	skill('humanizer', 'personal', 100),
	skill('dataviz', 'claude-code', 480),
	skill('ponytail:ponytail', 'plugin', 280),
	skill('ponytail:ponytail-gain', 'plugin', 110),
	skill('svelte:svelte-code-writer', 'plugin', 106),
];

const REPORT: SkillUsageReport = {
	since: '2026-06-30T10:35:42.832Z',
	uses: [
		{ name: 'adr', uses: 25, lastUsedAt: '2026-10-16T09:00:00.000Z' },
		{ name: 'ponytail:ponytail', uses: 3, lastUsedAt: '2026-10-01T09:00:00.000Z' },
		{ name: 'ponytail:ponytail-gain', uses: 1, lastUsedAt: '2026-10-10T09:00:00.000Z' },
		{ name: 'uninstalled', uses: 90, lastUsedAt: '2026-08-01T09:00:00.000Z' },
	],
	turnedOff: ['humanizer'],
	plugins: [
		{ id: 'ponytail@ponytail', name: 'ponytail', on: true },
		{ id: 'caveman@caveman', name: 'caveman', on: false },
	],
};

describe('skill usage', () => {
	it('ranks skills and plugins by use, then puts the costliest unused first', () => {
		const rows = skillUsageRows(CATALOG, REPORT);

		expect(rows.map(({ key, uses, on }) => [key, uses, on])).toEqual([
			['skill:adr', 25, true],
			['plugin:ponytail', 4, true],
			['skill:dataviz', 0, true],
			['plugin:svelte', 0, true],
			['skill:humanizer', 0, false],
		]);
		expect(rows[1]).toMatchObject({
			switchName: 'ponytail@ponytail',
			origin: 'ponytail',
			description: '2 skills: ponytail, ponytail-gain',
			tokens: 390,
			lastUsedAt: '2026-10-10T09:00:00.000Z',
		});
		expect(rows.find(({ name }) => name === 'svelte')?.switchName).toBeNull();
		expect(rows.map(skillUsageOrigin)).toEqual([
			'Repository · malini, gardener-game',
			'Plugin · ponytail',
			'Built into Claude Code',
			'Plugin',
			'Personal',
		]);
	});

	it('counts what is on and what of it nobody used', () => {
		expect(skillUsageSummary(skillUsageRows(CATALOG, REPORT))).toEqual({
			on: 5,
			tokens: 1096,
			unused: 2,
			unusedTokens: 586,
		});
	});

	it('switches a skill or a plugin in the report the way the settings file will', () => {
		const off = switchedReport(REPORT, { kind: 'skill', switchName: 'adr' }, false);
		expect(off.turnedOff).toEqual(['humanizer', 'adr']);
		expect(switchedReport(off, { kind: 'skill', switchName: 'humanizer' }, true).turnedOff).toEqual(
			['adr'],
		);
		expect(
			switchedReport(REPORT, { kind: 'plugin', switchName: 'caveman@caveman' }, true).plugins,
		).toContainEqual({ id: 'caveman@caveman', name: 'caveman', on: true });
		expect(switchedReport(REPORT, { kind: 'plugin', switchName: null }, false)).toBe(REPORT);
	});

	it('says whether Claude Code loads a skill, by its own switch or its plugin', () => {
		const off = { ...REPORT, plugins: [{ id: 'ponytail@ponytail', name: 'ponytail', on: false }] };
		expect(CATALOG.map((skill) => skillIsOn(skill, off))).toEqual([
			true,
			false,
			true,
			false,
			false,
			true,
		]);
		expect(CATALOG.every((skill) => skillIsOn(skill, null))).toBe(true);
	});

	it('heats a skill on a log scale against the most used one', () => {
		expect([0, 1, 10, 25, 100].map((uses) => skillHeat(uses, 100))).toEqual([0, 1, 2, 3, 4]);
		expect([21, 38, 60].map((uses) => skillHeat(uses, 60))).toEqual([3, 4, 4]);
		expect(skillHeat(1, 1)).toBe(4);
		expect(skillHeat(0, 0)).toBe(0);
	});

	it('says when a skill was last used', () => {
		const now = Date.parse('2026-10-17T12:00:00.000Z');
		expect(
			[null, '2026-10-17T08:00:00.000Z', '2026-10-16T08:00:00.000Z', '2026-10-12T08:00:00.000Z']
				.concat(['2026-09-20T08:00:00.000Z', '2026-07-01T08:00:00.000Z'])
				.map((at) => lastUsedLabel(at, now)),
		).toEqual([
			'Never used',
			'Used today',
			'Used yesterday',
			'Used 5 days ago',
			'Used 3 weeks ago',
			'Used 3 months ago',
		]);
	});
});
