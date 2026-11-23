import { randomUUID } from 'node:crypto';
import type { PlanSync } from '$contract/initiatives';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, intToBool, nowIso8601, parseJsonColumn, run } from '$main/db/rows';

export type GithubDeletionKind = 'milestone' | 'issue';

export type GithubDeletion = Readonly<{ kind: GithubDeletionKind; number: number }>;

export type SyncedInitiative = Readonly<{
	id: string;
	title: string;
	due_on: string | null;
	note: string | null;
	github_milestone: number | null;
	github_title: string | null;
	github_due_on: string | null;
	github_note: string | null;
}>;

export type SyncedDependency = Readonly<{
	id: string;
	initiative_id: string;
	title: string;
	done: number;
	note: string | null;
	assignee: string | null;
	github_issue: number | null;
	github_title: string | null;
	github_done: number | null;
	github_note: string | null;
}>;

export type InitiativeValues = Readonly<{
	title: string;
	dueOn: string | null;
	note: string | null;
}>;

export type MilestoneBase = Readonly<{
	number: number;
	title: string;
	dueOn: string | null;
	note: string;
}>;

export type DependencyValues = Readonly<{
	initiativeId: string;
	title: string;
	done: boolean;
	note: string | null;
	assignee: string | null;
}>;

export type IssueBase = Readonly<{ number: number; title: string; done: boolean; note: string }>;

export type MergeLink = Readonly<{
	dependency_id: string;
	workstream_id: string;
	repository_full_name: string;
}>;

type SyncRow = {
	enabled: number;
	home: string | null;
	synced_at: string | null;
	error: string | null;
	people: string;
};

const INITIATIVE_SYNC_COLUMNS =
	'id, title, due_on, note, github_milestone, github_title, github_due_on, github_note';

const DEPENDENCY_SYNC_COLUMNS = `d.id, d.initiative_id, d.title, d.done, d.note, d.assignee,
	d.github_issue, d.github_title, d.github_done, d.github_note`;

export function planSync(db: MaliniDatabase, repositoryFullName: string): PlanSync {
	const row = get<SyncRow>(
		db,
		`SELECT enabled, home, synced_at, error, people FROM initiative_syncs
		 WHERE repository_full_name = ?`,
		repositoryFullName,
	);
	const people = parseJsonColumn(row?.people ?? null);
	return {
		repositoryFullName,
		enabled: intToBool(row?.enabled ?? 0),
		home: row === null ? null : (row.home ?? repositoryFullName),
		syncedAt: row?.synced_at ?? null,
		error: row?.error ?? null,
		people: Array.isArray(people)
			? people.filter((login): login is string => typeof login === 'string')
			: [],
	};
}

export function isPlanSyncEnabled(db: MaliniDatabase, repositoryFullName: string): boolean {
	return planSync(db, repositoryFullName).enabled;
}

export function setPlanSyncEnabled(
	db: MaliniDatabase,
	repositoryFullName: string,
	enabled: boolean,
	home?: string,
): void {
	db.transaction(() => {
		const previous = planSync(db, repositoryFullName).home;
		if (home !== undefined && previous !== null && previous.toLowerCase() !== home.toLowerCase()) {
			unlinkPlan(db, repositoryFullName);
		}
		run(
			db,
			`INSERT INTO initiative_syncs (repository_full_name, enabled, home) VALUES (?, ?, ?)
			 ON CONFLICT (repository_full_name) DO UPDATE SET enabled = excluded.enabled, error = NULL,
			 home = COALESCE(excluded.home, home)`,
			repositoryFullName,
			enabled,
			home ?? null,
		);
	});
}

function unlinkPlan(db: MaliniDatabase, repositoryFullName: string): void {
	run(
		db,
		`UPDATE initiatives SET github_milestone = NULL, github_title = NULL, github_due_on = NULL,
		 github_note = NULL WHERE repository_full_name = ? COLLATE NOCASE`,
		repositoryFullName,
	);
	run(
		db,
		`UPDATE initiative_dependencies SET github_issue = NULL, github_title = NULL,
		 github_done = NULL, github_note = NULL
		 WHERE initiative_id IN (SELECT id FROM initiatives WHERE repository_full_name = ? COLLATE NOCASE)`,
		repositoryFullName,
	);
	run(
		db,
		'DELETE FROM initiative_github_deletions WHERE repository_full_name = ?',
		repositoryFullName,
	);
	run(
		db,
		`UPDATE initiative_syncs SET synced_at = NULL, people = '[]' WHERE repository_full_name = ?`,
		repositoryFullName,
	);
}

export function recordPlanSynced(
	db: MaliniDatabase,
	repositoryFullName: string,
	people: readonly string[] | null,
): void {
	run(
		db,
		`UPDATE initiative_syncs SET synced_at = ?, error = NULL, people = COALESCE(?, people)
		 WHERE repository_full_name = ?`,
		nowIso8601(),
		people === null ? null : JSON.stringify(people),
		repositoryFullName,
	);
}

export function recordPlanSyncError(
	db: MaliniDatabase,
	repositoryFullName: string,
	error: string,
): void {
	run(
		db,
		'UPDATE initiative_syncs SET error = ? WHERE repository_full_name = ?',
		error,
		repositoryFullName,
	);
}

export function addGithubDeletion(
	db: MaliniDatabase,
	repositoryFullName: string,
	kind: GithubDeletionKind,
	number: number,
): void {
	run(
		db,
		`INSERT OR IGNORE INTO initiative_github_deletions (repository_full_name, kind, number)
		 VALUES (?, ?, ?)`,
		repositoryFullName,
		kind,
		number,
	);
}

export function githubDeletions(db: MaliniDatabase, repositoryFullName: string): GithubDeletion[] {
	return all<GithubDeletion>(
		db,
		`SELECT kind, number FROM initiative_github_deletions WHERE repository_full_name = ?
		 ORDER BY kind DESC, number`,
		repositoryFullName,
	);
}

export function dropGithubDeletion(
	db: MaliniDatabase,
	repositoryFullName: string,
	deletion: GithubDeletion,
): void {
	run(
		db,
		`DELETE FROM initiative_github_deletions
		 WHERE repository_full_name = ? AND kind = ? AND number = ?`,
		repositoryFullName,
		deletion.kind,
		deletion.number,
	);
}

export function syncedInitiatives(
	db: MaliniDatabase,
	repositoryFullName: string,
): SyncedInitiative[] {
	return all<SyncedInitiative>(
		db,
		`SELECT ${INITIATIVE_SYNC_COLUMNS} FROM initiatives
		 WHERE repository_full_name = ? COLLATE NOCASE ORDER BY created_at, rowid`,
		repositoryFullName,
	);
}

export function syncedDependencies(
	db: MaliniDatabase,
	repositoryFullName: string,
): SyncedDependency[] {
	return all<SyncedDependency>(
		db,
		`SELECT ${DEPENDENCY_SYNC_COLUMNS} FROM initiative_dependencies d
		 JOIN initiatives i ON i.id = d.initiative_id
		 WHERE i.repository_full_name = ? COLLATE NOCASE ORDER BY d.position, d.rowid`,
		repositoryFullName,
	);
}

export function saveInitiativeSync(
	db: MaliniDatabase,
	id: string,
	values: InitiativeValues,
	base: MilestoneBase,
): void {
	run(
		db,
		`UPDATE initiatives SET title = ?, due_on = ?, note = ?, github_milestone = ?,
		 github_title = ?, github_due_on = ?, github_note = ? WHERE id = ?`,
		values.title,
		values.dueOn,
		values.note,
		base.number,
		base.title,
		base.dueOn,
		base.note,
		id,
	);
}

export function linkInitiative(db: MaliniDatabase, id: string, base: MilestoneBase): boolean {
	return (
		run(
			db,
			`UPDATE initiatives SET github_milestone = ?, github_title = ?, github_due_on = ?,
			 github_note = ? WHERE id = ?`,
			base.number,
			base.title,
			base.dueOn,
			base.note,
			id,
		).changes > 0
	);
}

export function insertInitiativeFromGithub(
	db: MaliniDatabase,
	repositoryFullName: string,
	values: InitiativeValues,
	base: MilestoneBase,
): string {
	const id = randomUUID();
	const now = nowIso8601();
	run(
		db,
		`INSERT INTO initiatives (id, repository_full_name, title, due_on, note, github_milestone,
		 github_title, github_due_on, github_note, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		repositoryFullName,
		values.title,
		values.dueOn,
		values.note,
		base.number,
		base.title,
		base.dueOn,
		base.note,
		now,
		now,
	);
	return id;
}

export function forgetInitiative(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM initiatives WHERE id = ?', id);
}

export function saveDependencySync(
	db: MaliniDatabase,
	id: string,
	values: DependencyValues,
	base: IssueBase,
): void {
	run(
		db,
		`UPDATE initiative_dependencies SET initiative_id = ?, title = ?, done = ?, note = ?,
		 assignee = ?, github_issue = ?, github_title = ?, github_done = ?, github_note = ?
		 WHERE id = ?`,
		values.initiativeId,
		values.title,
		values.done,
		values.note,
		values.assignee,
		base.number,
		base.title,
		base.done,
		base.note,
		id,
	);
}

export function linkDependency(db: MaliniDatabase, id: string, base: IssueBase): boolean {
	return (
		run(
			db,
			`UPDATE initiative_dependencies SET github_issue = ?, github_title = ?, github_done = ?,
			 github_note = ? WHERE id = ?`,
			base.number,
			base.title,
			base.done,
			base.note,
			id,
		).changes > 0
	);
}

export function insertDependencyFromGithub(
	db: MaliniDatabase,
	values: DependencyValues,
	base: IssueBase,
): void {
	run(
		db,
		`INSERT INTO initiative_dependencies (id, initiative_id, title, done, note, assignee,
		 github_issue, github_title, github_done, github_note, position, created_at)
		 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(position) + 1, 0), ?
		 FROM initiative_dependencies WHERE initiative_id = ?`,
		randomUUID(),
		values.initiativeId,
		values.title,
		values.done,
		values.note,
		values.assignee,
		base.number,
		base.title,
		base.done,
		base.note,
		nowIso8601(),
		values.initiativeId,
	);
}

export function forgetDependency(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM initiative_dependencies WHERE id = ?', id);
}

export function openMergeLinks(
	db: MaliniDatabase,
	where: Readonly<{ repositoryFullName: string } | { workstreamId: string }>,
): MergeLink[] {
	const [column, value] =
		'workstreamId' in where
			? ['l.workstream_id = ?', where.workstreamId]
			: ['i.repository_full_name = ? COLLATE NOCASE', where.repositoryFullName];
	return all<MergeLink>(
		db,
		`SELECT l.dependency_id, l.workstream_id, i.repository_full_name
		 FROM initiative_dependency_workstreams l
		 JOIN initiative_dependencies d ON d.id = l.dependency_id
		 JOIN initiatives i ON i.id = d.initiative_id
		 WHERE l.merge_closed_at IS NULL AND ${column}`,
		value,
	);
}

export function closeOnMerge(db: MaliniDatabase, link: MergeLink): void {
	run(db, 'UPDATE initiative_dependencies SET done = 1 WHERE id = ?', link.dependency_id);
	run(
		db,
		`UPDATE initiative_dependency_workstreams SET merge_closed_at = ?
		 WHERE dependency_id = ? AND workstream_id = ?`,
		nowIso8601(),
		link.dependency_id,
		link.workstream_id,
	);
}
