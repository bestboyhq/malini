import type { SkillPresetRecord, SkillRecord, SkillUsageReport } from '$contract/skills';
import type { FakeBridge } from './fake-bridge';

const FAKE_SKILL_TIME = '2026-01-01T00:00:00.000Z';

export const FAKE_SKILLS: readonly SkillRecord[] = [
	{ name: 'animate', description: 'Design web animations', source: 'personal', tokens: 315 },
	{ name: 'humanizer', description: 'Rewrite AI-sounding text', source: 'personal', tokens: 102 },
	{ name: 'adr', description: 'Record a decision', source: 'repository', tokens: 128 },
	{ name: 'ponytail:ponytail', description: 'Do less', source: 'plugin', tokens: 282 },
	{ name: 'dataviz', description: 'Charts', source: 'claude-code', tokens: 482 },
];

export function installSkillsFake(bridge: FakeBridge): void {
	const presets = new Map<string, SkillPresetRecord>();
	let usage: SkillUsageReport = fakeUsage();
	let nextPreset = 1;

	bridge.onReset(() => {
		presets.clear();
		usage = fakeUsage();
		nextPreset = 1;
	});

	bridge.define('skills.list', async () => [...FAKE_SKILLS]);

	bridge.define('skills.list-presets', async () => [...presets.values()]);

	bridge.define('skills.save-preset', async (input) => {
		const existing = input.id ? presets.get(input.id) : undefined;
		const preset: SkillPresetRecord = {
			id: existing?.id ?? `fake-preset-${nextPreset++}`,
			name: input.name.trim(),
			emoji: input.emoji === undefined ? (existing?.emoji ?? null) : input.emoji,
			skills: [...new Set(input.skills)],
			createdAt: existing?.createdAt ?? FAKE_SKILL_TIME,
			updatedAt: FAKE_SKILL_TIME,
		};
		presets.set(preset.id, preset);
		return preset;
	});

	bridge.define('skills.delete-preset', async (input) => {
		if (!presets.delete(input.presetId)) throw new Error('Skill preset not found');
		return null;
	});

	bridge.define('skills.usage', async () => usage);

	bridge.define('skills.switch', async (input) => {
		usage =
			input.kind === 'plugin'
				? {
						...usage,
						plugins: usage.plugins.map((plugin) =>
							plugin.id === input.name ? { ...plugin, on: input.on } : plugin,
						),
					}
				: {
						...usage,
						turnedOff: input.on
							? usage.turnedOff.filter((name) => name !== input.name)
							: [...usage.turnedOff, input.name],
					};
		return usage;
	});
}

function fakeUsage(): SkillUsageReport {
	return {
		since: FAKE_SKILL_TIME,
		uses: [
			{ name: 'adr', uses: 12, lastUsedAt: FAKE_SKILL_TIME },
			{ name: 'ponytail:ponytail', uses: 3, lastUsedAt: FAKE_SKILL_TIME },
		],
		turnedOff: [],
		plugins: [{ id: 'ponytail@ponytail', name: 'ponytail', on: true }],
	};
}
