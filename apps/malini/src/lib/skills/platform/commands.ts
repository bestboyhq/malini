import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import {
	SKILL_PRESET_NAME_MAX_LENGTH,
	type SkillChoice,
	type SkillPresetRecord,
	type SkillPresetSuggestion,
	type SkillRecord,
} from '$contract/skills';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import {
	getWorkstream,
	listConnectedRepositories,
	listProjects,
} from '$shared/repositories/repositories.platform';
import { isSkillChoice, isSkillNameList } from '../domain/skill-choice';
import { isPresetEmoji } from '../domain/skill-preset-emoji';
import { getSkillChoice, setSkillChoice } from './skill-choices.repository';
import {
	deleteSkillPreset,
	getSkillPreset,
	insertSkillPreset,
	listSkillPresets,
	setDefaultSkillPreset,
	updateSkillPreset,
} from './skill-presets.repository';
import { effectiveSkillChoice } from './skill-resolution';

export interface SkillsDeps {
	readonly listSkills: (cwd: string) => Promise<readonly SkillRecord[]>;
	readonly suggestPresets: (
		skills: readonly SkillRecord[],
	) => Promise<readonly SkillPresetSuggestion[]>;
	readonly resolveCheckout: (workstreamId: string) => Promise<string>;
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
				: [await deps.resolveCheckout(requireWorkstream(db, workstreamId))];
		return skillsIn(folders, deps.listSkills);
	});

	commands.define('skills.list-presets', () => listSkillPresets(db));

	commands.define('skills.suggest-presets', async () => {
		const skills = await skillsIn(repositoryFolders(db), deps.listSkills);
		if (skills.length === 0) return [];
		return [...(await deps.suggestPresets(skills))];
	});

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
				isDefault: false,
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

	commands.define('skills.set-default-preset', (args: unknown) => {
		const presetId = field(args, 'presetId');
		if (presetId !== null && typeof presetId !== 'string') {
			throw invalid('`presetId` must be a string or null');
		}
		setDefaultSkillPreset(db, presetId === null ? null : requirePreset(db, presetId).id);
		return listSkillPresets(db);
	});

	commands.define('skills.choice', (args: unknown) => {
		const workstreamId = requireWorkstream(db, requireString(args, 'workstreamId'));
		return effectiveSkillChoice(db, workstreamId, optionalString(args, 'sessionId'));
	});

	commands.define('skills.choose', (args: unknown) => {
		const workstreamId = requireWorkstream(db, requireString(args, 'workstreamId'));
		const sessionId = optionalString(args, 'sessionId');
		const choice = field(args, 'choice');
		if (!isSkillChoice(choice)) throw invalid('`choice` must be a skill choice');
		const ownsChoice = sessionId !== null && getSkillChoice(db, 'session', sessionId) !== null;
		if (ownsChoice) setSkillChoice(db, 'session', sessionId, cleanChoice(choice));
		else setSkillChoice(db, 'workstream', workstreamId, cleanChoice(choice));
		return effectiveSkillChoice(db, workstreamId, sessionId);
	});
}

async function skillsIn(
	folders: readonly string[],
	listSkills: SkillsDeps['listSkills'],
): Promise<SkillRecord[]> {
	const found = new Map<string, SkillRecord>();
	for (const folder of folders) {
		for (const skill of await listSkills(folder)) {
			if (!found.has(skill.name)) found.set(skill.name, skill);
		}
	}
	return [...found.values()];
}

function repositoryFolders(db: MaliniDatabase): string[] {
	const folders = new Set([
		...listConnectedRepositories(db).flatMap(({ localPath }) => (localPath ? [localPath] : [])),
		...listProjects(db).map(({ repoPath }) => repoPath),
	]);
	const existing = [...folders].filter((folder) => existsSync(folder));
	return existing.length > 0 ? existing : [homedir()];
}

function cleanChoice(choice: SkillChoice): SkillChoice {
	if (choice.kind !== 'custom') return choice;
	return { kind: 'custom', skills: [...new Set(choice.skills.map((skill) => skill.trim()))] };
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
