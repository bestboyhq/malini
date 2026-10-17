import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	ClaudePlugin,
	SkillUsageReport,
	SkillUse,
	SwitchSkillArgs,
	TurnedOffSkills,
} from '$contract/skills';
import { isRecord } from '$main/db/rows';
import { errorCode } from '$main/errors';
import { atomicReplaceFile } from '$main/fs/atomic';

export interface ClaudeConfigFiles {
	readonly settings: string;
	readonly state: string;
}

type JsonObject = Record<string, unknown>;

export function claudeConfigFiles(
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): ClaudeConfigFiles {
	const directory = env['CLAUDE_CONFIG_DIR'];
	if (directory) {
		return { settings: join(directory, 'settings.json'), state: join(directory, '.claude.json') };
	}
	return { settings: join(home, '.claude', 'settings.json'), state: join(home, '.claude.json') };
}

export async function readSkillUsage(files: ClaudeConfigFiles): Promise<SkillUsageReport> {
	const [state, settings] = await Promise.all([
		readJsonObject(files.state),
		readJsonObject(files.settings),
	]);
	const firstStart = state['firstStartTime'];
	return {
		since: typeof firstStart === 'string' ? firstStart : null,
		uses: skillUses(state['skillUsage']),
		turnedOff: turnedOffSkills(settings),
		plugins: claudePlugins(settings),
	};
}

export async function readTurnedOff(files: ClaudeConfigFiles): Promise<TurnedOffSkills> {
	const settings = await readJsonObject(files.settings).catch(() => ({}));
	return {
		skills: turnedOffSkills(settings),
		plugins: claudePlugins(settings).flatMap(({ id, on }) => (on ? [] : [id])),
	};
}

export async function switchSkill(
	files: ClaudeConfigFiles,
	change: SwitchSkillArgs,
): Promise<void> {
	const target = await realpath(files.settings).catch(() => files.settings);
	const settings = await readJsonObject(target);
	const switched =
		change.kind === 'skill'
			? withSkillSwitched(settings, change.name, change.on)
			: withPluginSwitched(settings, change.name, change.on);
	await atomicReplaceFile(target, `${JSON.stringify(switched, null, 2)}\n`);
}

export function withSkillSwitched(settings: JsonObject, name: string, on: boolean): JsonObject {
	const overrides = isRecord(settings['skillOverrides']) ? { ...settings['skillOverrides'] } : {};
	if (on) delete overrides[name];
	else overrides[name] = 'off';
	const switched: JsonObject = { ...settings, skillOverrides: overrides };
	if (Object.keys(overrides).length === 0) delete switched['skillOverrides'];
	return switched;
}

export function withPluginSwitched(settings: JsonObject, id: string, on: boolean): JsonObject {
	const plugins = settings['enabledPlugins'];
	if (!isRecord(plugins) || !(id in plugins)) {
		throw new Error(`The plugin \`${id}\` is not in your Claude Code settings.`);
	}
	return { ...settings, enabledPlugins: { ...plugins, [id]: on } };
}

function skillUses(usage: unknown): SkillUse[] {
	if (!isRecord(usage)) return [];
	return Object.entries(usage).flatMap(([name, entry]) => {
		if (!isRecord(entry) || typeof entry['usageCount'] !== 'number') return [];
		const lastUsedAt = entry['lastUsedAt'];
		return [
			{
				name,
				uses: Math.max(0, Math.floor(entry['usageCount'])),
				lastUsedAt: typeof lastUsedAt === 'number' ? new Date(lastUsedAt).toISOString() : null,
			},
		];
	});
}

function turnedOffSkills(settings: JsonObject): string[] {
	const overrides = settings['skillOverrides'];
	if (!isRecord(overrides)) return [];
	return Object.entries(overrides).flatMap(([name, value]) => (value === 'off' ? [name] : []));
}

function claudePlugins(settings: JsonObject): ClaudePlugin[] {
	const plugins = settings['enabledPlugins'];
	if (!isRecord(plugins)) return [];
	return Object.entries(plugins).flatMap(([id, value]) => {
		const at = id.lastIndexOf('@');
		if (at <= 0) return [];
		return [{ id, name: id.slice(0, at), on: value !== false }];
	});
}

async function readJsonObject(path: string): Promise<JsonObject> {
	let text: string;
	try {
		text = await readFile(path, 'utf8');
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return {};
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`${path} is not valid JSON, so malini leaves it alone.`);
	}
	if (!isRecord(parsed)) throw new Error(`${path} does not hold a JSON object.`);
	return parsed;
}
