import { INITIATIVE_TITLE_MAX_LENGTH, type Initiative } from '$contract/initiatives';
import { REPOSITORY_FULL_NAME_MAX_LENGTH } from '$contract/scratchpad';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { isDay } from '../domain/initiative';
import {
	addDependency,
	createInitiative,
	deleteDependency,
	deleteInitiative,
	linkWorkstream,
	listInitiatives,
	updateDependency,
	updateInitiative,
	type DependencyChange,
	type InitiativeChange,
} from './initiatives.repository';

export function registerInitiatives(context: MainContext): void {
	const { db, commands } = context;
	const after = (change: () => void): Initiative[] => {
		change();
		return listInitiatives(db);
	};

	commands.define('initiatives.list', () => listInitiatives(db));

	commands.define('initiatives.create', (args: unknown) => {
		const initiative = {
			repositoryFullName: repositoryFullName(field(args, 'repositoryFullName')),
			title: title(field(args, 'title')),
			dueOn: dueOn(field(args, 'dueOn')),
		};
		return after(() => createInitiative(db, initiative));
	});

	commands.define('initiatives.update', (args: unknown) => {
		const initiativeId = id(args, 'id');
		const change = initiativeChange(args);
		return after(() => updateInitiative(db, initiativeId, change));
	});

	commands.define('initiatives.delete', (args: unknown) => {
		const initiativeId = id(args, 'id');
		return after(() => deleteInitiative(db, initiativeId));
	});

	commands.define('initiatives.add-dependency', (args: unknown) => {
		const initiativeId = id(args, 'initiativeId');
		const newTitle = title(field(args, 'title'));
		return after(() => addDependency(db, initiativeId, newTitle));
	});

	commands.define('initiatives.update-dependency', (args: unknown) => {
		const dependencyId = id(args, 'id');
		const change = dependencyChange(args);
		return after(() => updateDependency(db, dependencyId, change));
	});

	commands.define('initiatives.delete-dependency', (args: unknown) => {
		const dependencyId = id(args, 'id');
		return after(() => deleteDependency(db, dependencyId));
	});

	commands.define('initiatives.link-workstream', (args: unknown) => {
		const dependencyId = id(args, 'dependencyId');
		const workstreamId = id(args, 'workstreamId');
		return after(() => linkWorkstream(db, dependencyId, workstreamId));
	});
}

function field(args: unknown, key: string): unknown {
	return isRecord(args) ? args[key] : undefined;
}

function id(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`invalid args: \`${key}\` must be an id`);
	}
	return value;
}

function repositoryFullName(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > REPOSITORY_FULL_NAME_MAX_LENGTH
	) {
		throw new Error('invalid args: `repositoryFullName` must be a repository name');
	}
	return value.trim();
}

function title(value: unknown): string {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (
		trimmed.length === 0 ||
		trimmed.length > INITIATIVE_TITLE_MAX_LENGTH ||
		/[\n\r\u2028\u2029]/u.test(trimmed)
	) {
		throw new Error(
			`invalid args: \`title\` must be one line of 1 to ${INITIATIVE_TITLE_MAX_LENGTH} characters`,
		);
	}
	return trimmed;
}

function dueOn(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || !isDay(value)) {
		throw new Error('invalid args: `dueOn` must be null or a YYYY-MM-DD day');
	}
	return value;
}

function initiativeChange(args: unknown): InitiativeChange {
	const newTitle = field(args, 'title');
	const newDueOn = field(args, 'dueOn');
	if (newTitle === undefined && newDueOn === undefined) {
		throw new Error('invalid args: give a `title` or a `dueOn` to change');
	}
	return {
		...(newTitle === undefined ? {} : { title: title(newTitle) }),
		...(newDueOn === undefined ? {} : { dueOn: dueOn(newDueOn) }),
	};
}

function dependencyChange(args: unknown): DependencyChange {
	const newTitle = field(args, 'title');
	const done = field(args, 'done');
	if (newTitle === undefined && done === undefined) {
		throw new Error('invalid args: give a `title` or `done` to change');
	}
	if (done !== undefined && typeof done !== 'boolean') {
		throw new Error('invalid args: `done` must be true or false');
	}
	return {
		...(newTitle === undefined ? {} : { title: title(newTitle) }),
		...(done === undefined ? {} : { done }),
	};
}
