import { describe, expect, it } from 'vitest';
import { agentSkills, turnedOn } from './skills.js';

describe('agentSkills', () => {
	it('names where each skill comes from and pairs it with its description', () => {
		const skills = agentSkills(
			[
				{ name: 'animate', source: 'userSettings', tokens: 315 },
				{ name: 'adr', source: 'projectSettings', tokens: 128 },
				{ name: 'ponytail:ponytail', source: 'plugin', tokens: 282 },
				{ name: 'dataviz', source: 'built-in', tokens: 482 },
				{ name: 'keybindings-help', source: 'built-in', tokens: 83 },
				{ name: 'house-style', source: 'policySettings', tokens: 40 },
			],
			[
				{ name: 'animate', description: '(sic) Design   web\nanimations', argumentHint: '' },
				{ name: 'adr', description: 'Record a decision', argumentHint: '' },
				{
					name: 'ponytail:ponytail',
					description: '(ponytail) Forces the laziest solution',
					argumentHint: '',
				},
				{ name: 'dataviz', description: 'Chart data', argumentHint: '', builtin: true },
			],
		);

		expect(skills).toEqual([
			{
				name: 'animate',
				description: '(sic) Design web animations',
				source: 'personal',
				tokens: 315,
			},
			{ name: 'adr', description: 'Record a decision', source: 'repository', tokens: 128 },
			{
				name: 'ponytail:ponytail',
				description: 'Forces the laziest solution',
				source: 'plugin',
				tokens: 282,
			},
			{ name: 'dataviz', description: 'Chart data', source: 'claude-code', tokens: 482 },
			{ name: 'keybindings-help', description: '', source: 'claude-code', tokens: 83 },
			{ name: 'house-style', description: '', source: 'other', tokens: 40 },
		]);
	});

	it('shortens a long description', () => {
		const [skill] = agentSkills(
			[{ name: 'long', source: 'userSettings', tokens: 1 }],
			[{ name: 'long', description: 'word '.repeat(200), argumentHint: '' }],
		);

		expect([...(skill?.description ?? '')]).toHaveLength(280);
		expect(skill?.description.endsWith('…')).toBe(true);
	});

	it('turns back on only what the user turned off, for the listing alone', () => {
		expect(turnedOn({ skills: [], plugins: [] })).toEqual({});
		expect(turnedOn({ skills: ['humanizer'], plugins: ['caveman@caveman'] })).toEqual({
			skillOverrides: { humanizer: 'on' },
			enabledPlugins: { 'caveman@caveman': true },
		});
	});
});
