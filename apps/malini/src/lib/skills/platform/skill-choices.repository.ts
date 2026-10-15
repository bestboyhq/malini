import type { SkillChoice } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import { get, nowIso8601, parseJsonColumn, run } from '$main/db/rows';
import { DEFAULT_SKILL_CHOICE, isSkillChoice } from '../domain/skill-choice';

export type SkillChoiceScope = 'workstream' | 'session';

export function getSkillChoice(
	db: MaliniDatabase,
	scope: SkillChoiceScope,
	ownerId: string,
): SkillChoice | null {
	const row = get<{ choice: string }>(
		db,
		'SELECT choice FROM skill_choices WHERE scope = ? AND owner_id = ?',
		scope,
		ownerId,
	);
	if (!row) return null;
	const choice = parseJsonColumn(row.choice);
	return isSkillChoice(choice) ? choice : DEFAULT_SKILL_CHOICE;
}

export function setSkillChoice(
	db: MaliniDatabase,
	scope: SkillChoiceScope,
	ownerId: string,
	choice: SkillChoice,
): void {
	run(
		db,
		`INSERT INTO skill_choices (scope, owner_id, choice, updated_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (scope, owner_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`,
		scope,
		ownerId,
		JSON.stringify(choice),
		nowIso8601(),
	);
}
