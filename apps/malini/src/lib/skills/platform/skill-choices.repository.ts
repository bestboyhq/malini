import type { SkillChoice } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import { get, nowIso8601, parseJsonColumn, run } from '$main/db/rows';
import { isSkillChoice } from '../domain/skill-choice';

export function getSessionSkillChoice(db: MaliniDatabase, sessionId: string): SkillChoice | null {
	const row = get<{ choice: string }>(
		db,
		"SELECT choice FROM skill_choices WHERE scope = 'session' AND owner_id = ?",
		sessionId,
	);
	if (!row) return null;
	const choice = parseJsonColumn(row.choice);
	return isSkillChoice(choice) ? choice : null;
}

export function setSessionSkillChoice(
	db: MaliniDatabase,
	sessionId: string,
	choice: SkillChoice,
): void {
	run(
		db,
		`INSERT INTO skill_choices (scope, owner_id, choice, updated_at) VALUES ('session', ?, ?, ?)
		 ON CONFLICT (scope, owner_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`,
		sessionId,
		JSON.stringify(choice),
		nowIso8601(),
	);
}
