import type { SkillChoice, SkillPresetRecord, SkillRecord } from '$contract/skills';
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
	const choices = new Map<string, SkillChoice>();
	let nextPreset = 1;

	bridge.onReset(() => {
		presets.clear();
		choices.clear();
		nextPreset = 1;
	});

	bridge.define('skills.list', async () => [...FAKE_SKILLS]);

	bridge.define('skills.list-presets', async () => [...presets.values()]);

	bridge.define('skills.save-preset', async (input) => {
		const existing = input.id ? presets.get(input.id) : undefined;
		const preset: SkillPresetRecord = {
			id: existing?.id ?? `fake-preset-${nextPreset++}`,
			name: input.name.trim(),
			skills: [...new Set(input.skills)],
			isDefault: existing?.isDefault ?? false,
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

	bridge.define('skills.set-default-preset', async (input) => {
		for (const [id, preset] of presets) {
			presets.set(id, { ...preset, isDefault: id === input.presetId });
		}
		return [...presets.values()];
	});

	bridge.define(
		'skills.choice',
		async (input) =>
			choices.get(`${input.workstreamId}:${input.sessionId ?? ''}`) ?? { kind: 'default' },
	);

	bridge.define('skills.choose', async (input) => {
		choices.set(`${input.workstreamId}:${input.sessionId ?? ''}`, input.choice);
		return input.choice;
	});
}
