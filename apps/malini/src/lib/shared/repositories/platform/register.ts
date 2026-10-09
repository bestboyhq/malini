import type { BrowserWindow } from 'electron';
import type { CommitWorkstreamRun, ReadWorkstreamImageArgs } from '$contract/commands';
import type { StartedContainerInput } from '$contract/system';
import type { MainContext } from '$main/context';
import { DEVELOPMENT_BUNDLE_IDENTIFIER, PRODUCTION_BUNDLE_IDENTIFIER } from '$main/docker/labels';
import { DockerOwnership } from '$main/docker/ownership';
import {
	DockerCliReaper,
	STARTUP_RECLAIM_BUDGET_MS,
	reclaimContainers,
	reclaimIsClean,
	recordUnfinishedTeardown,
	type ContainerReaper,
	type ContainerReclaim,
} from '$main/docker/reclaim';
import { describeError, failureOutput } from '$main/errors';
import { noPromptCredentialEnv, type GitCredentialEnv } from '$main/git/credentials';
import { validateBaseBranch, validateWorkstreamId } from '$main/git/paths';
import {
	diffAll,
	listWorkstreamFiles,
	workstreamChangeTotals,
	workstreamDiff,
	workstreamSnapshot,
} from '$main/git/diff';
import {
	abortWorkstreamOperation,
	commitWorkstreamBranch,
	pullWorkstreamBaseBranch,
	pushWorkstreamBranch,
	restartWorkstreamOnBase,
} from '$main/git/remote';
import { statusCollector } from '$main/git/status';
import { createNodeProcessRunner, processIsAlive, type ProcessRunner } from '$main/process/runner';
import type { RepositoriesPlatform } from '../repositories.platform';
import { field, optionalString, requireNonEmptyString, requireString } from './args';
import { createAvatarStore, validateOwner, type AvatarStoreOptions } from './avatars.service';
import { listBaseFiles } from './base-files.service';
import { WorkstreamBaseSync } from './base-sync.service';
import { createCheckoutResolver } from './checkout-resolver';
import { defaultCheckoutShell, type CheckoutShell } from './checkout-shell.service';
import { commitRunConsumed, recordCommitRun } from './commit-runs.repository';
import { deleteConnectedRepository } from './connected-repositories.repository';
import {
	connectRepository,
	defaultGhRunner,
	githubAuthStatus,
	listClones,
	listGithubRepositories,
	parseImportSource,
	type GhRunner,
} from './github.service';
import { readWorkstreamImage, parseWorkstreamId } from './images';
import { listProjects } from './projects.repository';
import { InstallRegistry, installDependencies } from './provisioning.service';
import { sweepArchivedLeftovers, type TeardownGuard } from './teardown.service';
import { createWorkstreamWatchers } from './watcher';
import { listWorkstreams } from './workstreams.repository';
import { projectDto, workstreamDto } from './workstream-dto';
import {
	createRepository,
	createWorkstream,
	removeRepository,
	retireWorkstream,
} from './workstreams.service';

export interface FolderPicker {
	pick(window: BrowserWindow | null): Promise<string | null>;
}

export interface RepositoriesDeps {
	getMainWindow?: () => BrowserWindow | null;
	readonly credentials?: GitCredentialEnv;
	readonly shell?: CheckoutShell;
	readonly ghRunner?: GhRunner;
	readonly folderPicker?: FolderPicker;
	readonly avatars?: AvatarStoreOptions;
	readonly runner?: ProcessRunner;
	readonly reaper?: ContainerReaper;
	readonly bundleIdentifier?: string;
	readonly startupReclaim?: boolean;
	readonly guardRunLease?: TeardownGuard;
	readonly log?: (line: string) => void;
}

export function registerRepositories(
	context: MainContext,
	deps: RepositoriesDeps = {},
): RepositoriesPlatform {
	const { commands, db, events, appDataRoot } = context;
	const credentials = deps.credentials ?? noPromptCredentialEnv;
	const shell = deps.shell ?? defaultCheckoutShell;
	const gh = deps.ghRunner ?? defaultGhRunner;
	const picker = deps.folderPicker ?? defaultFolderPicker;
	const getMainWindow = deps.getMainWindow ?? (() => null);
	const avatars = createAvatarStore({ appDataRoot }, deps.avatars);
	const runner = deps.runner ?? createNodeProcessRunner();
	const reaper = deps.reaper ?? new DockerCliReaper(runner);
	const bundleIdentifier =
		deps.bundleIdentifier ??
		(context.isDev ? DEVELOPMENT_BUNDLE_IDENTIFIER : PRODUCTION_BUNDLE_IDENTIFIER);
	const ownership = new DockerOwnership({ db, runner, appDataRoot, bundleIdentifier });
	const installs = new InstallRegistry(runner);
	const checkouts = createCheckoutResolver({ db, appDataRoot });
	const baseSync = new WorkstreamBaseSync({ db, credentials, checkouts });

	const guardRunLease = deps.guardRunLease;
	const guardTeardown: TeardownGuard = async (workstreamId, teardown) => {
		await installs.abortAndWait(workstreamId);
		return baseSync.whileTearingDown(workstreamId, () =>
			guardRunLease ? guardRunLease(workstreamId, teardown) : teardown(),
		);
	};
	const workstreams = {
		db,
		events,
		appDataRoot,
		credentials,
		baseSync,
		guardTeardown,
	};

	const watchers = createWorkstreamWatchers({
		db,
		events,
		resolveWorktree: (workstreamId) => checkouts.resolveCheckout(workstreamId),
		...(deps.log ? { log: deps.log } : {}),
	});
	void watchers.start();

	commands.define('repositories.list-workstreams', () =>
		listWorkstreams(db).map((row) => workstreamDto(appDataRoot, row)),
	);

	commands.define('repositories.list-repositories', () =>
		Promise.all(listProjects(db).map(projectDto)),
	);

	commands.define('repositories.create-repository', (args: unknown) =>
		createRepository(workstreams, {
			repoUrl: requireString(args, 'repoUrl'),
			githubToken: optionalString(args, 'githubToken'),
		}),
	);

	commands.define('repositories.create-workstream', (args: unknown) =>
		createWorkstream(workstreams, {
			projectRepoPath: requireString(args, 'projectRepoPath'),
			workstreamId: requireString(args, 'workstreamId'),
			baseBranch: requireString(args, 'baseBranch'),
			projectId: requireString(args, 'projectId'),
			name: requireString(args, 'name'),
			githubToken: optionalString(args, 'githubToken'),
		}),
	);

	commands.define('repositories.sync-workstream-base', (args: unknown) =>
		baseSync.sync(checkedWorkstreamId(args)),
	);

	commands.define('repositories.delete-workstream', (args: unknown) =>
		retireWorkstream(workstreams, requireString(args, 'workstreamId'), 'deleted'),
	);

	commands.define('repositories.archive-workstream', (args: unknown) =>
		retireWorkstream(workstreams, requireString(args, 'workstreamId'), 'archived'),
	);

	commands.define('repositories.workstream-diff', async (args: unknown) => {
		const worktree = await checkout(args);
		optionalString(args, 'path');
		const baseBranch = optionalString(args, 'baseBranch');
		return baseBranch === null ? diffAll(worktree) : workstreamDiff(worktree, baseBranch);
	});

	commands.define('repositories.workstream-files', async (args: unknown) =>
		listWorkstreamFiles(await checkout(args)),
	);

	commands.define('repositories.base-files', async (args: unknown) => {
		const repoPath = requireNonEmptyString(args, 'repoPath');
		const baseBranch = requireNonEmptyString(args, 'baseBranch');
		validateBaseBranch(baseBranch);
		if (!listProjects(db).some((project) => project.repoPath === repoPath)) {
			throw new Error(`Unknown repository: ${repoPath}`);
		}
		return listBaseFiles(repoPath, baseBranch);
	});

	commands.define('repositories.workstream-status', async (args: unknown) =>
		statusCollector(await checkout(args)),
	);

	commands.define('repositories.workstream-change-totals', async (args: unknown) => {
		const baseBranch = requireString(args, 'baseBranch');
		validateBaseBranch(baseBranch);
		return workstreamChangeTotals(await checkout(args), baseBranch);
	});

	commands.define('repositories.workstream-snapshot', async (args: unknown) => {
		const baseBranch = requireString(args, 'baseBranch');
		validateBaseBranch(baseBranch);
		return workstreamSnapshot(await checkout(args), baseBranch);
	});

	commands.define('repositories.reveal-workstream', async (args: unknown) => {
		await shell.reveal(await checkout(args));
	});

	commands.define('repositories.open-workstream-in-editor', async (args: unknown) => {
		await shell.openInEditor(await checkout(args));
	});

	commands.define('repositories.commit-workstream', async (args: unknown) => {
		const workstreamId = requireString(args, 'workstreamId');
		const run = commitRunArg(args);
		const freshRun = run && !commitRunConsumed(db, workstreamId, run.id) ? run : null;
		const message =
			run && !freshRun ? run.messageIfAlreadyCommitted : requireString(args, 'message');
		const worktree = await checkout(args);
		const commitMessage = message.trim().length === 0 ? 'Agent changes' : message;
		try {
			const sha = await commitWorkstreamBranch(worktree, workstreamId, commitMessage);
			if (freshRun) recordCommitRun(db, workstreamId, freshRun.id, sha);
			return sha;
		} catch (error) {
			const text = failureOutput(error);
			if (text.includes('nothing to commit') || text.includes('no changes added')) {
				throw new Error('Nothing to commit - no repository changes.');
			}
			throw error;
		}
	});

	commands.define('repositories.push-workstream', async (args: unknown) => {
		const workstreamId = requireString(args, 'workstreamId');
		const expectedRepositoryFullName = requireString(args, 'expectedRepositoryFullName');
		const githubToken = optionalString(args, 'githubToken');
		return pushWorkstreamBranch(
			await checkout(args),
			workstreamId,
			expectedRepositoryFullName,
			githubToken,
			credentials,
		);
	});

	commands.define('repositories.pull-workstream', async (args: unknown) => {
		const workstreamId = requireString(args, 'workstreamId');
		const baseBranch = requireString(args, 'baseBranch');
		const githubToken = optionalString(args, 'githubToken');
		return pullWorkstreamBaseBranch(
			await checkout(args),
			workstreamId,
			baseBranch,
			githubToken,
			credentials,
		);
	});

	commands.define('repositories.restart-workstream-on-base', async (args: unknown) => {
		const workstreamId = requireString(args, 'workstreamId');
		return restartWorkstreamOnBase(
			await checkout(args),
			workstreamId,
			requireString(args, 'baseBranch'),
			requireString(args, 'mergedHeadSha'),
			requireString(args, 'expectedRepositoryFullName'),
			optionalString(args, 'githubToken'),
			credentials,
		);
	});

	commands.define('repositories.abort-workstream-operation', async (args: unknown) =>
		abortWorkstreamOperation(await checkout(args), checkedWorkstreamId(args)),
	);

	commands.define('repositories.read-workstream-image', async (args: ReadWorkstreamImageArgs) => {
		parseWorkstreamId(args?.workstreamId);
		if (typeof args?.path !== 'string') throw new Error('image path must be a string');
		return readWorkstreamImage(await checkouts.resolveCheckout(args.workstreamId), args.path);
	});

	commands.define('repositories.pick-folder', () => picker.pick(getMainWindow()));

	commands.define('repositories.github-auth-status', () => githubAuthStatus(gh));

	commands.define('repositories.list-clones', () => listClones(db));

	commands.define('repositories.list-github-repositories', () => listGithubRepositories(gh));

	commands.define('repositories.connect', (args: unknown) =>
		connectRepository(db, gh, parseImportSource(field(args, 'source'))),
	);

	commands.define('repositories.owner-avatar', (args: unknown) =>
		avatars.get(validateOwner(field(args, 'owner'))),
	);

	commands.define('repositories.disconnect', (args: unknown) => {
		deleteConnectedRepository(db, requireNonEmptyString(args, 'repoId'));
	});

	commands.define('repositories.remove', (args: unknown) =>
		removeRepository(workstreams, requireNonEmptyString(args, 'repoId')),
	);

	commands.define('repositories.claim-docker-service', (args: unknown) =>
		ownership.claimService({
			repository: requireString(args, 'repository'),
			scope: requireString(args, 'scope'),
			workstreamId: requireString(args, 'workstreamId'),
			service: requireString(args, 'service'),
			owner: requireString(args, 'owner'),
			composeProject: optionalString(args, 'composeProject'),
		}),
	);

	commands.define('repositories.record-owned-docker-containers', (args: unknown) => {
		ownership.recordContainers(parseStartedContainers(field(args, 'containers')));
	});

	commands.define('repositories.release-owned-docker-container', (args: unknown) => {
		ownership.releaseContainer(requireString(args, 'containerId'));
	});

	commands.define('repositories.list-owned-docker-containers', () => ownership.reconcile());

	commands.define('repositories.provision-dependencies', async (args: unknown) => {
		const outcome = await provisionDependencies(requireString(args, 'workstreamId'));
		return outcome.status;
	});

	async function checkout(args: unknown): Promise<string> {
		return checkouts.resolveCheckout(checkedWorkstreamId(args));
	}

	function checkedWorkstreamId(args: unknown): string {
		const workstreamId = requireString(args, 'workstreamId');
		validateWorkstreamId(workstreamId);
		return workstreamId;
	}

	async function provisionDependencies(workstreamId: string) {
		const worktree = await checkouts.resolveCheckout(workstreamId);
		return installDependencies({ runner, events, registry: installs }, workstreamId, worktree);
	}

	const platform: RepositoriesPlatform = {
		checkouts,
		ownership,
		installs,
		watchers,
		bundleIdentifier,
		appInstanceId: ownership.appInstanceId,
		containerCount: () => ownership.ownedContainerCount(),
		listOwnedContainers: () => ownership.reconcile(),
		provisionDependencies,
		abortInstall: (workstreamId) => installs.abortAndWait(workstreamId),
		listLiveWorkstreamIds: () =>
			listWorkstreams(db)
				.filter((row) => row.status === 'active')
				.map((row) => row.id),
		async reclaimAbandonedContainers(budgetMs = STARTUP_RECLAIM_BUDGET_MS) {
			const reclaim = await reclaimContainers(
				db,
				ownership,
				'abandoned-by-a-previous-run',
				reaper,
				Date.now() + budgetMs,
				processIsAlive,
			);
			recordUnfinishedTeardown(db, 'boot', reclaim);
			return reclaim;
		},
	};

	if (deps.startupReclaim ?? true) void reportStartupReclaim(platform);
	void sweepArchivedLeftovers(db, appDataRoot);

	return platform;
}

async function reportStartupReclaim(platform: RepositoriesPlatform): Promise<void> {
	let reclaim: ContainerReclaim;
	try {
		reclaim = await platform.reclaimAbandonedContainers();
	} catch (error) {
		console.warn(`repositories: startup container reclaim skipped: ${describeError(error)}`);
		return;
	}
	if (reclaim.removed.length === 0 && reclaimIsClean(reclaim)) return;
	console.error(
		`repositories: startup reclaimed ${reclaim.removed.length} abandoned container(s), ${reclaim.unfinished.length} left behind`,
	);
}

const defaultFolderPicker: FolderPicker = {
	async pick(window) {
		const { dialog } = await import('electron');
		const result = window
			? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
			: await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
		if (result.canceled) return null;
		return result.filePaths[0] ?? null;
	},
};

function parseStartedContainers(value: unknown): StartedContainerInput[] {
	if (!Array.isArray(value)) throw new Error('invalid args: `containers` must be an array');
	return value.map((entry: unknown) => ({
		containerId: requireString(entry, 'containerId'),
		containerName: requireString(entry, 'containerName'),
		workstreamId: optionalString(entry, 'workstreamId'),
		composeProject: requireString(entry, 'composeProject'),
		service: requireString(entry, 'service'),
		owner: requireString(entry, 'owner'),
		cwd: requireString(entry, 'cwd'),
	}));
}

function commitRunArg(args: unknown): CommitWorkstreamRun | null {
	const value = field(args, 'run');
	if (value === undefined || value === null) return null;
	return {
		id: requireNonEmptyString(value, 'id'),
		messageIfAlreadyCommitted: requireString(value, 'messageIfAlreadyCommitted'),
	};
}
