import type { PlanSync } from '$contract/initiatives';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, intToBool, nowIso8601, parseJsonColumn, run } from '$main/db/rows';
import { canonicalNote, type SharedDependency, type SharedPlan } from './plan-file';

export type MergeLink = Readonly<{
	dependency_id: string;
	workstream_id: string;
	repository_full_name: string;
}>;

type SyncRow = {
	enabled: number;
	home: string | null;
	synced_at: string | null;
	synced_commit: string | null;
	error: string | null;
	people: string;
};

type OutcomeRow = {
	id: string;
	title: string;
	due_on: string | null;
	note: string | null;
	created_at: string;
};

type DependencyRow = {
	id: string;
	initiative_id: string;
	title: string;
	done: number;
	note: string | null;
	assignee: string | null;
	position: number;
};

export function planSync(db: MaliniDatabase, repositoryFullName: string): PlanSync {
	const row = syncRow(db, repositoryFullName);
	const people = parseJsonColumn(row?.people ?? null);
	return {
		repositoryFullName,
		enabled: intToBool(row?.enabled ?? 0),
		home: row?.home ?? null,
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

export function syncedCommit(db: MaliniDatabase, repositoryFullName: string): string | null {
	return syncRow(db, repositoryFullName)?.synced_commit ?? null;
}

export function setPlanSyncEnabled(
	db: MaliniDatabase,
	repositoryFullName: string,
	enabled: boolean,
	home?: string,
): void {
	db.transaction(() => {
		const previous = planSync(db, repositoryFullName).home;
		run(
			db,
			`INSERT INTO initiative_syncs (repository_full_name, enabled, home) VALUES (?, ?, ?)
			 ON CONFLICT (repository_full_name) DO UPDATE SET enabled = excluded.enabled, error = NULL,
			 home = COALESCE(excluded.home, home)`,
			repositoryFullName,
			enabled,
			home ?? null,
		);
		if (home !== undefined && previous !== null && previous.toLowerCase() !== home.toLowerCase()) {
			run(
				db,
				`UPDATE initiative_syncs SET synced_at = NULL, synced_commit = NULL, people = '[]'
				 WHERE repository_full_name = ?`,
				repositoryFullName,
			);
		}
	});
}

export function recordPlanBase(
	db: MaliniDatabase,
	repositoryFullName: string,
	commit: string | null,
): void {
	run(
		db,
		'UPDATE initiative_syncs SET synced_commit = ? WHERE repository_full_name = ?',
		commit,
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

export function localPlan(db: MaliniDatabase, repositoryFullName: string): SharedPlan {
	const dependencies = groupedDependencies(db, repositoryFullName);
	return outcomeRows(db, repositoryFullName).map((row) => ({
		id: row.id,
		title: row.title,
		dueOn: row.due_on,
		note: canonicalNote(row.note),
		createdAt: row.created_at,
		dependencies: (dependencies.get(row.id) ?? []).map(sharedDependency),
	}));
}

export function applyPlan(db: MaliniDatabase, repositoryFullName: string, plan: SharedPlan): void {
	const now = nowIso8601();
	const outcomes = new Map(outcomeRows(db, repositoryFullName).map((row) => [row.id, row]));
	const wanted = new Set(plan.map(({ id }) => id));
	for (const id of outcomes.keys()) {
		if (!wanted.has(id)) run(db, 'DELETE FROM initiatives WHERE id = ?', id);
	}
	const ours = new Set<string>();
	for (const outcome of plan) {
		const current = outcomes.get(outcome.id);
		if (current === undefined) {
			const inserted = run(
				db,
				`INSERT OR IGNORE INTO initiatives (id, repository_full_name, title, due_on, note,
				 created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				outcome.id,
				repositoryFullName,
				outcome.title,
				outcome.dueOn,
				outcome.note,
				outcome.createdAt,
				now,
			);
			if (inserted.changes > 0) ours.add(outcome.id);
			continue;
		}
		ours.add(outcome.id);
		if (
			current.title !== outcome.title ||
			current.due_on !== outcome.dueOn ||
			canonicalNote(current.note) !== outcome.note
		) {
			run(
				db,
				'UPDATE initiatives SET title = ?, due_on = ?, note = ?, updated_at = ? WHERE id = ?',
				outcome.title,
				outcome.dueOn,
				outcome.note,
				now,
				outcome.id,
			);
		}
	}
	applyDependencies(db, repositoryFullName, plan, ours);
}

function applyDependencies(
	db: MaliniDatabase,
	repositoryFullName: string,
	plan: SharedPlan,
	ours: ReadonlySet<string>,
): void {
	const current = new Map(
		[...groupedDependencies(db, repositoryFullName).values()].flat().map((row) => [row.id, row]),
	);
	const wanted = new Set(plan.flatMap(({ dependencies }) => dependencies.map(({ id }) => id)));
	for (const id of current.keys()) {
		if (!wanted.has(id)) run(db, 'DELETE FROM initiative_dependencies WHERE id = ?', id);
	}
	for (const outcome of plan) {
		if (!ours.has(outcome.id)) continue;
		outcome.dependencies.forEach((dependency, position) => {
			const row = current.get(dependency.id);
			if (row === undefined) {
				run(
					db,
					`INSERT OR IGNORE INTO initiative_dependencies (id, initiative_id, title, done, note,
					 assignee, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					dependency.id,
					outcome.id,
					dependency.title,
					dependency.done,
					dependency.note,
					dependency.assignee,
					position,
					nowIso8601(),
				);
			} else if (!sameDependency(row, outcome.id, dependency, position)) {
				run(
					db,
					`UPDATE initiative_dependencies SET initiative_id = ?, title = ?, done = ?, note = ?,
					 assignee = ?, position = ? WHERE id = ?`,
					outcome.id,
					dependency.title,
					dependency.done,
					dependency.note,
					dependency.assignee,
					position,
					dependency.id,
				);
			}
		});
	}
}

function sameDependency(
	row: DependencyRow,
	initiativeId: string,
	dependency: SharedDependency,
	position: number,
): boolean {
	return (
		row.initiative_id === initiativeId &&
		row.title === dependency.title &&
		intToBool(row.done) === dependency.done &&
		canonicalNote(row.note) === dependency.note &&
		row.assignee === dependency.assignee &&
		row.position === position
	);
}

function sharedDependency(row: DependencyRow): SharedDependency {
	return {
		id: row.id,
		title: row.title,
		done: intToBool(row.done),
		note: canonicalNote(row.note),
		assignee: row.assignee,
	};
}

function outcomeRows(db: MaliniDatabase, repositoryFullName: string): OutcomeRow[] {
	return all<OutcomeRow>(
		db,
		`SELECT id, title, due_on, note, created_at FROM initiatives
		 WHERE repository_full_name = ? COLLATE NOCASE ORDER BY created_at, rowid`,
		repositoryFullName,
	);
}

function groupedDependencies(
	db: MaliniDatabase,
	repositoryFullName: string,
): Map<string, DependencyRow[]> {
	const groups = new Map<string, DependencyRow[]>();
	for (const row of all<DependencyRow>(
		db,
		`SELECT d.id, d.initiative_id, d.title, d.done, d.note, d.assignee, d.position
		 FROM initiative_dependencies d JOIN initiatives i ON i.id = d.initiative_id
		 WHERE i.repository_full_name = ? COLLATE NOCASE ORDER BY d.position, d.rowid`,
		repositoryFullName,
	)) {
		groups.set(row.initiative_id, [...(groups.get(row.initiative_id) ?? []), row]);
	}
	return groups;
}

function syncRow(db: MaliniDatabase, repositoryFullName: string): SyncRow | null {
	return get<SyncRow>(
		db,
		`SELECT enabled, home, synced_at, synced_commit, error, people FROM initiative_syncs
		 WHERE repository_full_name = ?`,
		repositoryFullName,
	);
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
