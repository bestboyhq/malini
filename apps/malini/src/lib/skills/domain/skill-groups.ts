import type { SkillRecord, SkillSource } from '$contract/skills';

export type SkillGroup = Readonly<{
	key: string;
	label: string;
	skills: readonly SkillRecord[];
}>;

const SOURCE_ORDER: readonly SkillSource[] = [
	'repository',
	'personal',
	'plugin',
	'claude-code',
	'other',
];

const SOURCE_LABELS: Readonly<Record<SkillSource, string>> = {
	repository: 'Repository',
	personal: 'Personal',
	plugin: 'Plugins',
	'claude-code': 'Built into Claude Code',
	other: 'Managed',
};

export function groupSkills(skills: readonly SkillRecord[]): SkillGroup[] {
	return SOURCE_ORDER.flatMap((source) => {
		const ofSource = skills.filter((skill) => skill.source === source);
		if (ofSource.length === 0) return [];
		return [{ key: source, label: SOURCE_LABELS[source], skills: ofSource }];
	});
}

export function skillSourceLabel(source: SkillSource): string {
	return SOURCE_LABELS[source];
}

export function skillPlugin(name: string): string | null {
	const separator = name.indexOf(':');
	return separator > 0 ? name.slice(0, separator) : null;
}

export function skillShortName(name: string): string {
	const plugin = skillPlugin(name);
	return plugin === null ? name : name.slice(plugin.length + 1);
}

export function matchesSkillFilter(skill: SkillRecord, filter: string): boolean {
	const needle = filter.trim().toLowerCase();
	if (needle.length === 0) return true;
	return (
		skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)
	);
}

export function skillTokens(
	skills: readonly SkillRecord[],
	names: readonly string[] | 'all',
): number {
	const chosen = names === 'all' ? null : new Set(names);
	return skills
		.filter((skill) => chosen === null || chosen.has(skill.name))
		.reduce((total, skill) => total + skill.tokens, 0);
}

export function formatTokens(tokens: number): string {
	if (tokens < 1_000) return `${tokens} tok.`;
	return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k tok.`;
}
