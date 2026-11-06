import type { AgentReasoningEffort } from '$contract/agent';
import type {
	AutomationBuiltin,
	AutomationChatSight,
	AutomationDefinitionRecord,
	AutomationEventSight,
	AutomationRunMode,
	AutomationRunsIn,
} from '$contract/automations';
import { isSkillNameList } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import { all, column, get, nowIso8601, parseJsonColumn, run } from '$main/db/rows';

interface AutomationDefinitionRow {
	id: string;
	name: string;
	instructions: string;
	provider: string;
	model: string;
	effort: AgentReasoningEffort;
	runs_in: AutomationRunsIn;
	skills: string;
	builtin: AutomationBuiltin | null;
	trigger_when: string | null;
	trigger_mode: AutomationRunMode | null;
	then_automation_id: string | null;
	sees_event: AutomationEventSight;
	sees_before: number;
	sees_chats: AutomationChatSight;
	sees_attachments: number;
	reaches_internet: number;
	created_at: string;
	updated_at: string;
}

const COLUMNS =
	'id, name, instructions, provider, model, effort, runs_in, skills, builtin, trigger_when, trigger_mode, then_automation_id, sees_event, sees_before, sees_chats, sees_attachments, reaches_internet, created_at, updated_at';

function fromRow(row: AutomationDefinitionRow): AutomationDefinitionRecord {
	const skills = parseJsonColumn(row.skills);
	return {
		id: row.id,
		name: row.name,
		instructions: row.instructions,
		provider: row.provider,
		model: row.model,
		effort: row.effort,
		runsIn: row.runs_in,
		skills: isSkillNameList(skills) ? skills : [],
		builtin: row.builtin,
		trigger:
			row.trigger_when === null || row.trigger_mode === null
				? null
				: { when: row.trigger_when, mode: row.trigger_mode },
		thenAutomationId: row.then_automation_id,
		boundary: {
			event: row.sees_event,
			before: row.sees_before === 1,
			chats: row.sees_chats,
			attachments: row.sees_attachments === 1,
			internet: row.reaches_internet === 1,
		},
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function listAutomationDefinitions(db: MaliniDatabase): AutomationDefinitionRecord[] {
	return all<AutomationDefinitionRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_definitions ORDER BY builtin IS NULL, created_at, rowid`,
	).map(fromRow);
}

export function getAutomationDefinition(
	db: MaliniDatabase,
	id: string,
): AutomationDefinitionRecord | null {
	const row = get<AutomationDefinitionRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_definitions WHERE id = ?`,
		id,
	);
	return row ? fromRow(row) : null;
}

export function getBuiltinAutomationDefinition(
	db: MaliniDatabase,
	builtin: AutomationBuiltin,
): AutomationDefinitionRecord | null {
	const row = get<AutomationDefinitionRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_definitions WHERE builtin = ?`,
		builtin,
	);
	return row ? fromRow(row) : null;
}

export function insertAutomationDefinition(
	db: MaliniDatabase,
	definition: AutomationDefinitionRecord,
): boolean {
	return (
		run(
			db,
			`INSERT INTO automation_definitions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT DO NOTHING`,
			definition.id,
			definition.name,
			definition.instructions,
			definition.provider,
			definition.model,
			definition.effort,
			definition.runsIn,
			JSON.stringify(definition.skills),
			definition.builtin,
			definition.trigger?.when ?? null,
			definition.trigger?.mode ?? null,
			definition.thenAutomationId,
			...boundaryColumns(definition),
			definition.createdAt,
			definition.updatedAt,
		).changes > 0
	);
}

export function updateAutomationDefinition(
	db: MaliniDatabase,
	definition: AutomationDefinitionRecord,
): void {
	run(
		db,
		`UPDATE automation_definitions
		 SET name = ?, instructions = ?, provider = ?, model = ?, effort = ?, runs_in = ?, skills = ?,
		     trigger_when = ?, trigger_mode = ?, then_automation_id = ?, sees_event = ?, sees_before = ?,
		     sees_chats = ?, sees_attachments = ?, reaches_internet = ?, updated_at = ?
		 WHERE id = ?`,
		definition.name,
		definition.instructions,
		definition.provider,
		definition.model,
		definition.effort,
		definition.runsIn,
		JSON.stringify(definition.skills),
		definition.trigger?.when ?? null,
		definition.trigger?.mode ?? null,
		definition.thenAutomationId,
		...boundaryColumns(definition),
		definition.updatedAt,
		definition.id,
	);
}

function boundaryColumns({ boundary }: AutomationDefinitionRecord) {
	return [
		boundary.event,
		Number(boundary.before),
		boundary.chats,
		Number(boundary.attachments),
		Number(boundary.internet),
	] as const;
}

export function clearThenLinksTo(db: MaliniDatabase, automationId: string): string[] {
	return column(
		db,
		'UPDATE automation_definitions SET then_automation_id = NULL, updated_at = ? WHERE then_automation_id = ? RETURNING id',
		nowIso8601(),
		automationId,
	);
}

export function deleteAutomationDefinition(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM automation_definitions WHERE id = ?', id);
}
