import type { SkillPresetRecord } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, intToBool, parseJsonColumn, run } from '$main/db/rows';
import { isSkillNameList } from '../domain/skill-choice';
import { isPresetEmoji } from '../domain/skill-preset-emoji';

interface SkillPresetRow {
	id: string;
	name: string;
	emoji: string | null;
	skills: string;
	is_default: number;
	created_at: string;
	updated_at: string;
}

const COLUMNS = 'id, name, emoji, skills, is_default, created_at, updated_at';

function fromRow(row: SkillPresetRow): SkillPresetRecord {
	const skills = parseJsonColumn(row.skills);
	return {
		id: row.id,
		name: row.name,
		emoji: isPresetEmoji(row.emoji) ? row.emoji : null,
		skills: isSkillNameList(skills) ? skills : [],
		isDefault: intToBool(row.is_default),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function listSkillPresets(db: MaliniDatabase): SkillPresetRecord[] {
	return all<SkillPresetRow>(
		db,
		`SELECT ${COLUMNS} FROM skill_presets ORDER BY created_at, rowid`,
	).map(fromRow);
}

export function getSkillPreset(db: MaliniDatabase, id: string): SkillPresetRecord | null {
	const row = get<SkillPresetRow>(db, `SELECT ${COLUMNS} FROM skill_presets WHERE id = ?`, id);
	return row ? fromRow(row) : null;
}

export function insertSkillPreset(db: MaliniDatabase, preset: SkillPresetRecord): void {
	run(
		db,
		`INSERT INTO skill_presets (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		preset.id,
		preset.name,
		preset.emoji,
		JSON.stringify(preset.skills),
		preset.isDefault ? 1 : 0,
		preset.createdAt,
		preset.updatedAt,
	);
}

export function updateSkillPreset(db: MaliniDatabase, preset: SkillPresetRecord): void {
	run(
		db,
		'UPDATE skill_presets SET name = ?, emoji = ?, skills = ?, updated_at = ? WHERE id = ?',
		preset.name,
		preset.emoji,
		JSON.stringify(preset.skills),
		preset.updatedAt,
		preset.id,
	);
}

export function deleteSkillPreset(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM skill_presets WHERE id = ?', id);
}

export function setDefaultSkillPreset(db: MaliniDatabase, id: string | null): void {
	db.transaction(() => {
		run(db, 'UPDATE skill_presets SET is_default = 0 WHERE is_default = 1');
		if (id !== null) run(db, 'UPDATE skill_presets SET is_default = 1 WHERE id = ?', id);
	});
}
