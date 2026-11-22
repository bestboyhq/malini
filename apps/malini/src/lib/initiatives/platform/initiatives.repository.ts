import { randomUUID } from 'node:crypto';
import type {
	CreateInitiativeArgs,
	Initiative,
	InitiativeDependency,
	InitiativeWorkstream,
} from '$contract/initiatives';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, intToBool, nowIso8601, run } from '$main/db/rows';
import { MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '$main/errors';
import { latestWorkstreamTurn } from '$lib/chat/chat.platform';
import { addGithubDeletion } from './plan-sync.repository';

const INITIATIVE_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'not-found': 'bug',
} as const satisfies ErrorVerdicts;

type InitiativeErrorKind = keyof typeof INITIATIVE_ERROR_VERDICTS;

export class InitiativeError extends MaliniError<InitiativeErrorKind> {
	constructor(kind: InitiativeErrorKind, message: string) {
		super('InitiativeError', INITIATIVE_ERROR_VERDICTS, kind, message);
	}
}

type InitiativeRow = {
	id: string;
	repository_full_name: string;
	title: string;
	due_on: string | null;
	note: string | null;
	github_milestone: number | null;
};
type DependencyRow = {
	id: string;
	initiative_id: string;
	title: string;
	done: number;
	note: string | null;
	github_issue: number | null;
	assignee: string | null;
};
type LinkRow = { dependency_id: string; workstream_id: string };

const INITIATIVE_COLUMNS = 'id, repository_full_name, title, due_on, note, github_milestone';

export type InitiativeChange = Readonly<{
	title?: string;
	dueOn?: string | null;
	note?: string | null;
}>;
export type DependencyChange = Readonly<{ title?: string; done?: boolean; note?: string | null }>;

export function listInitiatives(db: MaliniDatabase): Initiative[] {
	const links = all<LinkRow>(
		db,
		`SELECT dependency_id, workstream_id FROM initiative_dependency_workstreams
		 ORDER BY created_at, rowid`,
	);
	const needs = new Map(
		[...new Set(links.map((link) => link.workstream_id))].map((workstreamId) => [
			workstreamId,
			latestWorkstreamTurn(db, workstreamId)?.need ?? null,
		]),
	);
	const workstreams = groupBy(links, 'dependency_id', (link): InitiativeWorkstream => ({
		workstreamId: link.workstream_id,
		needs: needs.get(link.workstream_id) ?? null,
	}));
	const dependencies = groupBy(
		all<DependencyRow>(
			db,
			`SELECT id, initiative_id, title, done, note, github_issue, assignee
			 FROM initiative_dependencies ORDER BY position, rowid`,
		),
		'initiative_id',
		(row): InitiativeDependency => ({
			id: row.id,
			title: row.title,
			done: intToBool(row.done),
			note: row.note,
			workstreams: workstreams.get(row.id) ?? [],
			githubIssue: row.github_issue,
			assignee: row.assignee,
		}),
	);
	return all<InitiativeRow>(
		db,
		`SELECT ${INITIATIVE_COLUMNS} FROM initiatives
		 ORDER BY due_on IS NULL, due_on, created_at, rowid`,
	).map((row) => ({
		id: row.id,
		repositoryFullName: row.repository_full_name,
		title: row.title,
		dueOn: row.due_on,
		note: row.note,
		dependencies: dependencies.get(row.id) ?? [],
		githubMilestone: row.github_milestone,
	}));
}

export function createInitiative(db: MaliniDatabase, initiative: CreateInitiativeArgs): void {
	const now = nowIso8601();
	run(
		db,
		`INSERT INTO initiatives (id, repository_full_name, title, due_on, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		randomUUID(),
		initiative.repositoryFullName,
		initiative.title,
		initiative.dueOn,
		now,
		now,
	);
}

export function updateInitiative(db: MaliniDatabase, id: string, change: InitiativeChange): void {
	const current = initiativeRow(db, id);
	run(
		db,
		'UPDATE initiatives SET title = ?, due_on = ?, note = ?, updated_at = ? WHERE id = ?',
		change.title ?? current.title,
		change.dueOn === undefined ? current.due_on : change.dueOn,
		change.note === undefined ? current.note : change.note,
		nowIso8601(),
		id,
	);
}

export function deleteInitiative(db: MaliniDatabase, id: string): void {
	const current = initiativeRow(db, id);
	db.transaction(() => {
		const repository = current.repository_full_name;
		if (current.github_milestone !== null) {
			addGithubDeletion(db, repository, 'milestone', current.github_milestone);
		}
		const issues = all<{ github_issue: number }>(
			db,
			`SELECT github_issue FROM initiative_dependencies
			 WHERE initiative_id = ? AND github_issue IS NOT NULL`,
			id,
		);
		for (const { github_issue } of issues) addGithubDeletion(db, repository, 'issue', github_issue);
		run(db, 'DELETE FROM initiatives WHERE id = ?', id);
	});
}

export function addDependency(db: MaliniDatabase, initiativeId: string, title: string): void {
	initiativeRow(db, initiativeId);
	run(
		db,
		`INSERT INTO initiative_dependencies (id, initiative_id, title, done, position, created_at)
		 SELECT ?, ?, ?, 0, COALESCE(MAX(position) + 1, 0), ?
		 FROM initiative_dependencies WHERE initiative_id = ?`,
		randomUUID(),
		initiativeId,
		title,
		nowIso8601(),
		initiativeId,
	);
	touch(db, initiativeId);
}

export function updateDependency(db: MaliniDatabase, id: string, change: DependencyChange): void {
	const current = dependencyRow(db, id);
	run(
		db,
		'UPDATE initiative_dependencies SET title = ?, done = ?, note = ? WHERE id = ?',
		change.title ?? current.title,
		change.done ?? intToBool(current.done),
		change.note === undefined ? current.note : change.note,
		id,
	);
	touch(db, current.initiative_id);
}

export function deleteDependency(db: MaliniDatabase, id: string): void {
	const current = dependencyRow(db, id);
	db.transaction(() => {
		if (current.github_issue !== null) {
			const { repository_full_name } = initiativeRow(db, current.initiative_id);
			addGithubDeletion(db, repository_full_name, 'issue', current.github_issue);
		}
		run(db, 'DELETE FROM initiative_dependencies WHERE id = ?', id);
		touch(db, current.initiative_id);
	});
}

export function initiativeRepository(db: MaliniDatabase, id: string): string {
	return initiativeRow(db, id).repository_full_name;
}

export function dependencyRepository(db: MaliniDatabase, id: string): string {
	return initiativeRepository(db, dependencyRow(db, id).initiative_id);
}

export function linkWorkstream(
	db: MaliniDatabase,
	dependencyId: string,
	workstreamId: string,
): void {
	const current = dependencyRow(db, dependencyId);
	run(
		db,
		`INSERT OR IGNORE INTO initiative_dependency_workstreams (dependency_id, workstream_id, created_at)
		 VALUES (?, ?, ?)`,
		dependencyId,
		workstreamId,
		nowIso8601(),
	);
	touch(db, current.initiative_id);
}

function initiativeRow(db: MaliniDatabase, id: string): InitiativeRow {
	const row = get<InitiativeRow>(
		db,
		`SELECT ${INITIATIVE_COLUMNS} FROM initiatives WHERE id = ?`,
		id,
	);
	if (!row) throw unknownInitiative(id);
	return row;
}

function dependencyRow(db: MaliniDatabase, id: string): DependencyRow {
	const row = get<DependencyRow>(
		db,
		`SELECT id, initiative_id, title, done, note, github_issue, assignee
		 FROM initiative_dependencies WHERE id = ?`,
		id,
	);
	if (!row) throw new InitiativeError('not-found', `no initiative dependency ${id}`);
	return row;
}

function touch(db: MaliniDatabase, initiativeId: string): void {
	run(db, 'UPDATE initiatives SET updated_at = ? WHERE id = ?', nowIso8601(), initiativeId);
}

function unknownInitiative(id: string): InitiativeError {
	return new InitiativeError('not-found', `no initiative ${id}`);
}

function groupBy<Row, Key extends keyof Row, Item>(
	rows: readonly Row[],
	key: Key,
	item: (row: Row) => Item,
): Map<Row[Key], Item[]> {
	const groups = new Map<Row[Key], Item[]>();
	for (const row of rows) {
		const group = groups.get(row[key]);
		if (group) group.push(item(row));
		else groups.set(row[key], [item(row)]);
	}
	return groups;
}
