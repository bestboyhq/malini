import { randomUUID } from 'node:crypto';
import type { Initiative, InitiativeDependency, InitiativeWorkstream } from '$contract/initiatives';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, intToBool, nowIso8601, run } from '$main/db/rows';
import { latestWorkstreamTurn } from '$lib/chat/chat.platform';

type InitiativeRow = { id: string; title: string; due_on: string | null };
type DependencyRow = { id: string; initiative_id: string; title: string; done: number };
type LinkRow = { dependency_id: string; workstream_id: string };

export type InitiativeChange = Readonly<{ title?: string; dueOn?: string | null }>;
export type DependencyChange = Readonly<{ title?: string; done?: boolean }>;

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
			`SELECT id, initiative_id, title, done FROM initiative_dependencies
			 ORDER BY position, rowid`,
		),
		'initiative_id',
		(row): InitiativeDependency => ({
			id: row.id,
			title: row.title,
			done: intToBool(row.done),
			workstreams: workstreams.get(row.id) ?? [],
		}),
	);
	return all<InitiativeRow>(
		db,
		`SELECT id, title, due_on FROM initiatives
		 ORDER BY due_on IS NULL, due_on, created_at, rowid`,
	).map((row) => ({
		id: row.id,
		title: row.title,
		dueOn: row.due_on,
		dependencies: dependencies.get(row.id) ?? [],
	}));
}

export function createInitiative(db: MaliniDatabase, title: string, dueOn: string | null): void {
	const now = nowIso8601();
	run(
		db,
		`INSERT INTO initiatives (id, title, due_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		randomUUID(),
		title,
		dueOn,
		now,
		now,
	);
}

export function updateInitiative(db: MaliniDatabase, id: string, change: InitiativeChange): void {
	const current = initiativeRow(db, id);
	run(
		db,
		'UPDATE initiatives SET title = ?, due_on = ?, updated_at = ? WHERE id = ?',
		change.title ?? current.title,
		change.dueOn === undefined ? current.due_on : change.dueOn,
		nowIso8601(),
		id,
	);
}

export function deleteInitiative(db: MaliniDatabase, id: string): void {
	if (run(db, 'DELETE FROM initiatives WHERE id = ?', id).changes === 0) {
		throw unknownInitiative(id);
	}
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
		'UPDATE initiative_dependencies SET title = ?, done = ? WHERE id = ?',
		change.title ?? current.title,
		change.done ?? intToBool(current.done),
		id,
	);
	touch(db, current.initiative_id);
}

export function deleteDependency(db: MaliniDatabase, id: string): void {
	const current = dependencyRow(db, id);
	run(db, 'DELETE FROM initiative_dependencies WHERE id = ?', id);
	touch(db, current.initiative_id);
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
	const row = get<InitiativeRow>(db, 'SELECT id, title, due_on FROM initiatives WHERE id = ?', id);
	if (!row) throw unknownInitiative(id);
	return row;
}

function dependencyRow(db: MaliniDatabase, id: string): DependencyRow {
	const row = get<DependencyRow>(
		db,
		'SELECT id, initiative_id, title, done FROM initiative_dependencies WHERE id = ?',
		id,
	);
	if (!row) throw new Error(`no initiative dependency ${id}`);
	return row;
}

function touch(db: MaliniDatabase, initiativeId: string): void {
	run(db, 'UPDATE initiatives SET updated_at = ? WHERE id = ?', nowIso8601(), initiativeId);
}

function unknownInitiative(id: string): Error {
	return new Error(`no initiative ${id}`);
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
