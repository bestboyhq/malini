import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import {
	SKILL_NAME_MAX_LENGTH,
	SKILL_PRESET_NAME_MAX_LENGTH,
	type SkillPresetRecord,
	type SkillRecord,
	type SwitchSkillArgs,
	type TurnedOffSkills,
} from '$contract/skills';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import {
	getWorkstream,
	listConnectedRepositories,
	listProjects,
	projectIdentityIdsForRepository,
	repositoryName,
} from '$shared/repositories/repositories.platform';
import { isSkillNameList } from '../domain/skill-choice';
import { isPresetEmoji } from '../domain/skill-preset-emoji';
import {
	readSkillUsage,
	readTurnedOff,
	switchSkill,
	type ClaudeConfigFiles,
} from './claude-settings';
import {
	deleteSkillPreset,
	getSkillPreset,
	insertSkillPreset,
	listSkillPresets,
	updateSkillPreset,
} from './skill-presets.repository';

export interface SkillsDeps {
	readonly listSkills: (cwd: string, turnedOff: TurnedOffSkills) => Promise<readonly SkillRecord[]>;
	readonly resolveCheckout: (workstreamId: string) => Promise<string>;
	readonly claudeConfig: () => ClaudeConfigFiles;
}

export type SkillErrorKind = 'invalid-args' | 'not-found';

export class SkillError extends Error {
	readonly kind: SkillErrorKind;

	constructor(kind: SkillErrorKind, message: string) {
		super(message);
		this.name = 'SkillError';
		this.kind = kind;
	}
}

export function defineSkillCommands(context: MainContext, deps: SkillsDeps): void {
	const { db, commands } = context;

	commands.define('skills.list', async (args: unknown) => {
		const workstreamId = optionalString(args, 'workstreamId');
		const folders =
			workstreamId === null
				? repositoryFolders(db)
				: [
						{
							path: await deps.resolveCheckout(requireWorkstream(db, workstreamId)),
							repository: null,
						},
					];
		const turnedOff = await readTurnedOff(deps.claudeConfig());
		return skillsIn(folders, (folder) => deps.listSkills(folder, turnedOff));
	});

	commands.define('skills.usage', () => readSkillUsage(deps.claudeConfig()));

	commands.define('skills.switch', async (args: unknown) => {
		const files = deps.claudeConfig();
		await switchSkill(files, switchArgs(args));
		return readSkillUsage(files);
	});

	commands.define('skills.list-presets', () => listSkillPresets(db));

	commands.define('skills.save-preset', (args: unknown) => {
		const id = optionalString(args, 'id');
		const name = presetName(args);
		const skills = presetSkills(args);
		const emoji = presetEmoji(args);
		const now = nowIso8601();
		if (id === null) {
			const created: SkillPresetRecord = {
				id: randomUUID(),
				name,
				emoji: emoji ?? null,
				skills,
				createdAt: now,
				updatedAt: now,
			};
			insertSkillPreset(db, created);
			return created;
		}
		const existing = requirePreset(db, id);
		const saved: SkillPresetRecord = {
			...existing,
			name,
			emoji: emoji === undefined ? existing.emoji : emoji,
			skills,
			updatedAt: now,
		};
		updateSkillPreset(db, saved);
		return saved;
	});

	commands.define('skills.delete-preset', (args: unknown) => {
		deleteSkillPreset(db, requirePreset(db, requireString(args, 'presetId')).id);
		return null;
	});
}

type SkillFolder = Readonly<{ path: string; repository: string | null }>;

async function skillsIn(
	folders: readonly SkillFolder[],
	listSkills: (folder: string) => Promise<readonly SkillRecord[]>,
): Promise<SkillRecord[]> {
	const found = new Map<string, SkillRecord>();
	for (const { path, repository } of folders) {
		for (const skill of await listSkills(path)) {
			const known = found.get(skill.name) ?? skill;
			const repositories = known.repositories ?? [];
			const named =
				skill.source === 'repository' && repository !== null && !repositories.includes(repository);
			found.set(
				skill.name,
				named ? { ...known, repositories: [...repositories, repository] } : known,
			);
		}
	}
	return [...found.values()];
}

function repositoryFolders(db: MaliniDatabase): SkillFolder[] {
	const connected = listConnectedRepositories(db);
	const projectNames = new Map(
		connected.flatMap(({ fullName }) =>
			projectIdentityIdsForRepository(fullName).map(
				(id) => [id, repositoryName(fullName)] as const,
			),
		),
	);
	const folders = new Map<string, string>();
	for (const { localPath, fullName } of connected) {
		if (localPath) folders.set(localPath, repositoryName(fullName));
	}
	for (const { id, name, repoPath } of listProjects(db)) {
		if (!folders.has(repoPath)) folders.set(repoPath, projectNames.get(id) ?? name);
	}
	const existing = [...folders]
		.filter(([path]) => existsSync(path))
		.map(([path, repository]) => ({ path, repository }));
	return existing.length > 0 ? existing : [{ path: homedir(), repository: null }];
}

function switchArgs(args: unknown): SwitchSkillArgs {
	const kind = field(args, 'kind');
	const name = requireString(args, 'name');
	const on = field(args, 'on');
	if (kind !== 'skill' && kind !== 'plugin') throw invalid('`kind` must be `skill` or `plugin`');
	if (typeof on !== 'boolean') throw invalid('`on` must be a boolean');
	if (name.length > SKILL_NAME_MAX_LENGTH) {
		throw invalid(`\`name\` must be at most ${SKILL_NAME_MAX_LENGTH} characters`);
	}
	if (kind === 'skill' && name.includes(':')) {
		throw invalid('a plugin skill turns on and off with its plugin');
	}
	if (kind === 'plugin' && name.lastIndexOf('@') <= 0) {
		throw invalid('`name` must be a plugin id like `name@marketplace`');
	}
	return { kind, name, on };
}

function presetName(args: unknown): string {
	const name = requireString(args, 'name').trim();
	if (name.length === 0 || name.length > SKILL_PRESET_NAME_MAX_LENGTH) {
		throw invalid(`\`name\` must be 1 to ${SKILL_PRESET_NAME_MAX_LENGTH} characters`);
	}
	return name;
}

function presetEmoji(args: unknown): string | null | undefined {
	const emoji = field(args, 'emoji');
	if (emoji === undefined || emoji === null) return emoji;
	if (!isPresetEmoji(emoji)) throw invalid('`emoji` must be a single emoji or null');
	return emoji;
}

function presetSkills(args: unknown): string[] {
	const skills = field(args, 'skills');
	if (!isSkillNameList(skills)) throw invalid('`skills` must be a list of skill names');
	return [...new Set(skills.map((skill) => skill.trim()))];
}

function requirePreset(db: MaliniDatabase, presetId: string): SkillPresetRecord {
	const preset = getSkillPreset(db, presetId);
	if (!preset) throw new SkillError('not-found', `Skill preset \`${presetId}\` not found.`);
	return preset;
}

function requireWorkstream(db: MaliniDatabase, workstreamId: string): string {
	if (!getWorkstream(db, workstreamId)) {
		throw new SkillError('not-found', `Workstream \`${workstreamId}\` not found.`);
	}
	return workstreamId;
}

function field(args: unknown, key: string): unknown {
	return isRecord(args) ? args[key] : undefined;
}

function requireString(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string' || value.length === 0) {
		throw invalid(`\`${key}\` must be a non-empty string`);
	}
	return value;
}

function optionalString(args: unknown, key: string): string | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.length === 0) {
		throw invalid(`\`${key}\` must be a non-empty string when present`);
	}
	return value;
}

function invalid(message: string): SkillError {
	return new SkillError('invalid-args', `invalid args: ${message}`);
}
