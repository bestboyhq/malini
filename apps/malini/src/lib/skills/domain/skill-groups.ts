import type { SkillRecord, SkillSource } from '$contract/skills';

const SOURCE_LABELS: Readonly<Record<SkillSource, string>> = {
	repository: 'Repository',
	personal: 'Personal',
	plugin: 'Plugins',
	'claude-code': 'Built into Claude Code',
	other: 'Managed',
};

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

export function skillTokens(skills: readonly SkillRecord[], names: readonly string[]): number {
	const chosen = new Set(names);
	return skills
		.filter((skill) => chosen.has(skill.name))
		.reduce((total, skill) => total + skill.tokens, 0);
}

export function formatTokens(tokens: number): string {
	if (tokens < 1_000) return `${tokens} tok.`;
	return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k tok.`;
}
