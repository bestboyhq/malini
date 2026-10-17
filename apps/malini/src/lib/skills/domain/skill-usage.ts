import type { ClaudePlugin, SkillRecord, SkillSource, SkillUsageReport } from '$contract/skills';
import { skillPlugin, skillShortName, skillSourceLabel } from './skill-groups';

export type SkillHeat = 0 | 1 | 2 | 3 | 4;

export type SkillUsageRow = Readonly<{
	key: string;
	kind: 'skill' | 'plugin';
	name: string;
	switchName: string | null;
	source: SkillSource;
	origin: string | null;
	description: string;
	skills: readonly string[];
	tokens: number;
	uses: number;
	lastUsedAt: string | null;
	on: boolean;
	heat: SkillHeat;
}>;

export type SkillUsageSummary = Readonly<{
	on: number;
	tokens: number;
	unused: number;
	unusedTokens: number;
}>;

export type SkillUsage = Readonly<{
	report: SkillUsageReport | null;
	state: 'idle' | 'loading' | 'ready' | 'error';
	error: string | null;
}>;

type Use = Readonly<{ uses: number; lastUsedAt: string | null }>;

const NEVER: Use = { uses: 0, lastUsedAt: null };
const DAY_MS = 86_400_000;

export function skillUsageRows(
	catalog: readonly SkillRecord[],
	report: SkillUsageReport,
): SkillUsageRow[] {
	const uses = new Map(report.uses.map(({ name, ...use }) => [name, use]));
	const turnedOff = new Set(report.turnedOff);
	const skills = catalog.filter(({ source }) => source !== 'plugin');
	const plugins = new Map<string, SkillRecord[]>();
	for (const skill of catalog) {
		if (skill.source !== 'plugin') continue;
		const plugin = skillPlugin(skill.name) ?? skill.name;
		plugins.set(plugin, [...(plugins.get(plugin) ?? []), skill]);
	}
	const rows = [
		...skills.map((skill) => skillRow(skill, uses.get(skill.name) ?? NEVER, turnedOff)),
		...[...plugins].map(([name, ofPlugin]) =>
			pluginRow(name, ofPlugin, uses, pluginNamed(report.plugins, name)),
		),
	];
	const hottest = Math.max(0, ...rows.map((row) => row.uses));
	return rows
		.map((row) => ({ ...row, heat: skillHeat(row.uses, hottest) }))
		.sort(
			(left, right) =>
				right.uses - left.uses ||
				(right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '') ||
				right.tokens - left.tokens ||
				left.name.localeCompare(right.name),
		);
}

export function skillIsOn(skill: SkillRecord, report: SkillUsageReport | null): boolean {
	if (report === null) return true;
	if (skill.source !== 'plugin') return !report.turnedOff.includes(skill.name);
	return pluginNamed(report.plugins, skillPlugin(skill.name) ?? skill.name)?.on ?? true;
}

export function skillUsageSummary(rows: readonly SkillUsageRow[]): SkillUsageSummary {
	const on = rows.filter((row) => row.on);
	const unused = on.filter((row) => row.uses === 0);
	return {
		on: on.reduce((total, row) => total + skillCount(row), 0),
		tokens: on.reduce((total, row) => total + row.tokens, 0),
		unused: unused.reduce((total, row) => total + skillCount(row), 0),
		unusedTokens: unused.reduce((total, row) => total + row.tokens, 0),
	};
}

export function switchedReport(
	report: SkillUsageReport,
	row: Pick<SkillUsageRow, 'kind' | 'switchName'>,
	on: boolean,
): SkillUsageReport {
	const name = row.switchName;
	if (name === null) return report;
	if (row.kind === 'plugin') {
		return {
			...report,
			plugins: report.plugins.map((plugin) => (plugin.id === name ? { ...plugin, on } : plugin)),
		};
	}
	const others = report.turnedOff.filter((skill) => skill !== name);
	return { ...report, turnedOff: on ? others : [...others, name] };
}

export function skillUsageOrigin(row: Pick<SkillUsageRow, 'kind' | 'source' | 'origin'>): string {
	const kind = row.kind === 'plugin' ? 'Plugin' : skillSourceLabel(row.source);
	return row.origin === null ? kind : `${kind} · ${row.origin}`;
}

export function skillUsesLabel(uses: number): string {
	if (uses === 0) return 'No uses';
	return `${uses.toLocaleString('en')} ${uses === 1 ? 'use' : 'uses'}`;
}

export function matchesUsageFilter(row: SkillUsageRow, filter: string): boolean {
	const needle = filter.trim().toLowerCase();
	if (needle.length === 0) return true;
	return [row.name, row.description, row.origin ?? ''].some((text) =>
		text.toLowerCase().includes(needle),
	);
}

export function skillHeat(uses: number, hottest: number): SkillHeat {
	if (uses <= 0 || hottest <= 0) return 0;
	const level = Math.round((Math.log1p(uses) / Math.log1p(hottest)) * 4);
	return level >= 4 ? 4 : level <= 1 ? 1 : level === 2 ? 2 : 3;
}

export function lastUsedLabel(lastUsedAt: string | null, now: number): string {
	if (lastUsedAt === null) return 'Never used';
	const days = Math.floor((now - Date.parse(lastUsedAt)) / DAY_MS);
	const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	if (days < 1) return 'Used today';
	if (days < 14) return `Used ${format.format(-days, 'day')}`;
	if (days < 60) return `Used ${format.format(-Math.floor(days / 7), 'week')}`;
	return `Used ${format.format(-Math.floor(days / 30), 'month')}`;
}

function skillRow(skill: SkillRecord, use: Use, turnedOff: ReadonlySet<string>): SkillUsageRow {
	return {
		key: `skill:${skill.name}`,
		kind: 'skill',
		name: skill.name,
		switchName: skill.name,
		source: skill.source,
		origin: skill.repositories?.length ? skill.repositories.join(', ') : null,
		description: skill.description,
		skills: [skill.name],
		tokens: skill.tokens,
		...use,
		on: !turnedOff.has(skill.name),
		heat: 0,
	};
}

function pluginRow(
	name: string,
	skills: readonly SkillRecord[],
	uses: ReadonlyMap<string, Use>,
	plugin: ClaudePlugin | null,
): SkillUsageRow {
	const used = skills.map((skill) => uses.get(skill.name) ?? NEVER);
	const lastUsedAt = used.reduce<string | null>(
		(latest, { lastUsedAt: at }) => (at !== null && (latest === null || at > latest) ? at : latest),
		null,
	);
	return {
		key: `plugin:${name}`,
		kind: 'plugin',
		name,
		switchName: plugin?.id ?? null,
		source: 'plugin',
		origin: plugin ? plugin.id.slice(plugin.id.lastIndexOf('@') + 1) : null,
		description: pluginDescription(skills),
		skills: skills.map((skill) => skill.name),
		tokens: skills.reduce((total, skill) => total + skill.tokens, 0),
		uses: used.reduce((total, use) => total + use.uses, 0),
		lastUsedAt,
		on: plugin?.on ?? true,
		heat: 0,
	};
}

function pluginDescription(skills: readonly SkillRecord[]): string {
	const [only] = skills;
	if (skills.length === 1 && only) return only.description;
	return `${skills.length} skills: ${skills.map((skill) => skillShortName(skill.name)).join(', ')}`;
}

function pluginNamed(plugins: readonly ClaudePlugin[], name: string): ClaudePlugin | null {
	const named = plugins.filter((plugin) => plugin.name === name);
	return named.find(({ on }) => on) ?? named[0] ?? null;
}

function skillCount(row: SkillUsageRow): number {
	return row.kind === 'plugin' ? row.skills.length : 1;
}
