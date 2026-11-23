import { INITIATIVE_TITLE_MAX_LENGTH, type Initiative, type PlanSync } from '$contract/initiatives';
import {
	REPOSITORY_FULL_NAME_MAX_LENGTH,
	SCRATCHPAD_CONTENT_MAX_LENGTH,
} from '$contract/scratchpad';
import { isScratchpadContent } from '$lib/scratchpad/scratchpad.platform';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { isDay } from '../domain/initiative';
import { isGithubRepository } from './github-plan';
import {
	addDependency,
	createInitiative,
	deleteDependency,
	deleteInitiative,
	dependencyRepository,
	initiativeRepository,
	InitiativeError,
	linkWorkstream,
	listInitiatives,
	updateDependency,
	updateInitiative,
	type DependencyChange,
	type InitiativeChange,
} from './initiatives.repository';
import { planSync, setPlanSyncEnabled } from './plan-sync.repository';
import { PlanSyncService, type PlanSyncDeps } from './plan-sync.service';

export function registerInitiatives(context: MainContext, deps: PlanSyncDeps): void {
	const { db, commands, events } = context;
	const github = new PlanSyncService(context, deps);
	const after = (repository: string, change: () => void): Initiative[] => {
		change();
		github.pushSoon(repository);
		return listInitiatives(db);
	};

	commands.define('initiatives.list', () => listInitiatives(db));

	commands.define('initiatives.create', (args: unknown) => {
		const initiative = {
			repositoryFullName: repositoryFullName(field(args, 'repositoryFullName')),
			title: title(field(args, 'title')),
			dueOn: dueOn(field(args, 'dueOn')),
		};
		return after(initiative.repositoryFullName, () => createInitiative(db, initiative));
	});

	commands.define('initiatives.update', (args: unknown) => {
		const initiativeId = id(args, 'id');
		const change = initiativeChange(args);
		const repository = initiativeRepository(db, initiativeId);
		return after(repository, () => updateInitiative(db, initiativeId, change));
	});

	commands.define('initiatives.delete', (args: unknown) => {
		const initiativeId = id(args, 'id');
		const repository = initiativeRepository(db, initiativeId);
		return after(repository, () => deleteInitiative(db, initiativeId));
	});

	commands.define('initiatives.add-dependency', (args: unknown) => {
		const initiativeId = id(args, 'initiativeId');
		const newTitle = title(field(args, 'title'));
		const repository = initiativeRepository(db, initiativeId);
		return after(repository, () => addDependency(db, initiativeId, newTitle));
	});

	commands.define('initiatives.update-dependency', (args: unknown) => {
		const dependencyId = id(args, 'id');
		const change = dependencyChange(args);
		const repository = dependencyRepository(db, dependencyId);
		return after(repository, () => updateDependency(db, dependencyId, change));
	});

	commands.define('initiatives.delete-dependency', (args: unknown) => {
		const dependencyId = id(args, 'id');
		const repository = dependencyRepository(db, dependencyId);
		return after(repository, () => deleteDependency(db, dependencyId));
	});

	commands.define('initiatives.link-workstream', (args: unknown) => {
		const dependencyId = id(args, 'dependencyId');
		const workstreamId = id(args, 'workstreamId');
		const repository = dependencyRepository(db, dependencyId);
		return after(repository, () => linkWorkstream(db, dependencyId, workstreamId));
	});

	async function syncState(repository: string): Promise<PlanSync> {
		const state = planSync(db, repository);
		if (state.enabled || !isGithubRepository(repository)) {
			return state.enabled ? state : { ...state, home: null };
		}
		const known = github.knownHome(repository);
		const home = known !== undefined ? known : await github.homeOf(repository).catch(() => null);
		return { ...state, home };
	}

	commands.define('initiatives.sync-state', (args: unknown) =>
		syncState(repositoryFullName(field(args, 'repositoryFullName'))),
	);

	commands.define('initiatives.set-sync', async (args: unknown) => {
		const repository = repositoryFullName(field(args, 'repositoryFullName'));
		const enabled = field(args, 'enabled');
		if (typeof enabled !== 'boolean') {
			throw new InitiativeError(
				'invalid-argument',
				'invalid args: `enabled` must be true or false',
			);
		}
		if (enabled && !isGithubRepository(repository)) {
			throw new InitiativeError(
				'invalid-argument',
				'invalid args: `repositoryFullName` must be a GitHub owner/name to sync',
			);
		}
		if (enabled) await github.turnOn(repository);
		else setPlanSyncEnabled(db, repository, false);
		return syncState(repository);
	});

	commands.define('initiatives.sync', async (args: unknown) => {
		await github.sync(repositoryFullName(field(args, 'repositoryFullName')));
		return listInitiatives(db);
	});

	events.subscribe('pull-requests:ship-changed', ({ workstreamId, merged }) => {
		if (merged !== undefined) github.mergedWorkstream(workstreamId);
	});
	events.subscribe('pull-requests:pull-request-changed', ({ workstreamId, state }) => {
		if (state === 'merged') github.mergedWorkstream(workstreamId);
	});
}

function field(args: unknown, key: string): unknown {
	return isRecord(args) ? args[key] : undefined;
}

function id(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new InitiativeError('invalid-argument', `invalid args: \`${key}\` must be an id`);
	}
	return value;
}

function repositoryFullName(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > REPOSITORY_FULL_NAME_MAX_LENGTH
	) {
		throw new InitiativeError(
			'invalid-argument',
			'invalid args: `repositoryFullName` must be a repository name',
		);
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
		throw new InitiativeError(
			'invalid-argument',
			`invalid args: \`title\` must be one line of 1 to ${INITIATIVE_TITLE_MAX_LENGTH} characters`,
		);
	}
	return trimmed;
}

function dueOn(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || !isDay(value)) {
		throw new InitiativeError(
			'invalid-argument',
			'invalid args: `dueOn` must be null or a YYYY-MM-DD day',
		);
	}
	return value;
}

function note(value: unknown): string | null {
	if (value === null) return null;
	if (
		typeof value !== 'string' ||
		value.length > SCRATCHPAD_CONTENT_MAX_LENGTH ||
		!isScratchpadContent(value)
	) {
		throw new InitiativeError(
			'invalid-argument',
			'invalid args: `note` must be null or a scratchpad document',
		);
	}
	return value;
}

function initiativeChange(args: unknown): InitiativeChange {
	const newTitle = field(args, 'title');
	const newDueOn = field(args, 'dueOn');
	const newNote = field(args, 'note');
	if (newTitle === undefined && newDueOn === undefined && newNote === undefined) {
		throw new InitiativeError(
			'invalid-argument',
			'invalid args: give a `title`, a `dueOn` or a `note` to change',
		);
	}
	return {
		...(newTitle === undefined ? {} : { title: title(newTitle) }),
		...(newDueOn === undefined ? {} : { dueOn: dueOn(newDueOn) }),
		...(newNote === undefined ? {} : { note: note(newNote) }),
	};
}

function dependencyChange(args: unknown): DependencyChange {
	const newTitle = field(args, 'title');
	const done = field(args, 'done');
	const newNote = field(args, 'note');
	if (newTitle === undefined && done === undefined && newNote === undefined) {
		throw new InitiativeError(
			'invalid-argument',
			'invalid args: give a `title`, `done` or a `note` to change',
		);
	}
	if (done !== undefined && typeof done !== 'boolean') {
		throw new InitiativeError('invalid-argument', 'invalid args: `done` must be true or false');
	}
	return {
		...(newTitle === undefined ? {} : { title: title(newTitle) }),
		...(done === undefined ? {} : { done }),
		...(newNote === undefined ? {} : { note: note(newNote) }),
	};
}
