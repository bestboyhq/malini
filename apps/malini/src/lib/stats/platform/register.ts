import { net } from 'electron';
import {
	STATS_PARTS,
	type ActivityStats,
	type SharePartArgs,
	type ShareCard,
	type StopRunningArgs,
} from '$contract/stats';
import { STATS_PROFILE_CHANGED_CHANNEL, STATS_RESOURCES_SAMPLED_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import {
	MAX_MEMORY_LOG_BYTES,
	MEMORY_LOG_STEM,
	type MemoryJournalEntry,
} from '$main/diagnostics/diagnostics-files';
import { isRecord } from '$main/db/rows';
import { appendNdjsonRecord } from '$main/diagnostics/ndjson-log';
import { thrownDetail } from '$main/diagnostics/thrown';
import { workstreamsRoot } from '$main/git/paths';
import type { ProcessRunner } from '$main/process/runner';
import { listOpenRuns, listRunActivity } from '$lib/chat/chat.platform';
import {
	displayWorkstreamName,
	listConnectedRepositories,
	listWorkstreams,
	managedProjectIdForRepository,
} from '$shared/repositories/repositories.platform';
import { localDate, summarizeActivity } from '../domain/activity';
import { catalogNames, NO_SETUP } from '../domain/catalog-names';
import { readAgentSetup, type ClaudeFiles } from './agent-setup';
import { Bestboy, bestboyOrigin, type BestboyFetch } from './bestboy';
import { ProfileStore, type TokenCipher } from './profile-store';
import {
	createGitHubIdentity,
	createRepositoryVisibility,
	NOT_PUBLIC,
	readPublicRepositories,
	readPublishedStats,
} from './published-stats';
import { ResourceSampler, type BrowserTab } from './resource-sampler';
import { StatsProfile } from './stats-profile';
import type { WorkstreamFolder } from './running-docker';
import { WorkstreamRunningMonitor } from './workstream-running';

export interface StatsDeps {
	readonly runner: ProcessRunner;
	browserTabs(): readonly BrowserTab[];
	agentHostProcessId(): number | null;
	runningContainerIds(): Promise<string[]>;
	stopBackgroundTask(sessionId: string, taskId: string): Promise<void>;
	nameService(task: string): Promise<string>;
	openExternal(url: string): Promise<void>;
	claudeFiles(): ClaudeFiles;
	readonly cipher: TokenCipher;
	readonly fetch?: BestboyFetch;
}

export interface StatsPlatform {
	start(): void;
	stop(): void;
	stopWorkstreamLeftovers(workstreamId: string): Promise<void>;
	openUrl(url: string): void;
}

export function registerStats(context: MainContext, deps: StatsDeps): StatsPlatform {
	const { commands, events, db } = context;
	const sampler = new ResourceSampler({
		runner: deps.runner,
		appProcessId: process.pid,
		browserTabs: () => deps.browserTabs(),
		agentHostProcessId: () => deps.agentHostProcessId(),
		runningContainerIds: () => deps.runningContainerIds(),
		workstreams: () =>
			listWorkstreams(db).map((workstream) => ({
				path: workstream.path,
				name: displayWorkstreamName(workstream),
			})),
		sampled: (sample) => events.emit(STATS_RESOURCES_SAMPLED_CHANNEL, sample),
		journaled: memoryJournal(context.appDataRoot),
	});

	commands.define('stats.resources', () => sampler.history());
	commands.define('stats.resource-breakdown', () => sampler.breakdown());
	commands.define('stats.activity', () => readActivity(db, new Date()));

	const running = new WorkstreamRunningMonitor({
		db,
		events,
		runner: deps.runner,
		nameService: (task) => deps.nameService(task),
		stopBackgroundTask: (sessionId, taskId) => deps.stopBackgroundTask(sessionId, taskId),
	});
	commands.define('stats.workstream-running', () => running.snapshot());
	commands.define('stats.stop-running', (args: unknown) => {
		const { workstreamId, itemIds } = stopRunningArgs(args);
		return running.stopItems(workstreamId, itemIds);
	});

	const liveFolders = (): WorkstreamFolder[] =>
		listWorkstreams(db).map(({ id, path }) => ({ id, path }));

	const visibility = createRepositoryVisibility();
	const github = createGitHubIdentity();
	const profile = new StatsProfile({
		bestboy: new Bestboy(
			bestboyOrigin(!context.isDev, process.env),
			deps.fetch ?? ((url, init) => net.fetch(url, init)),
		),
		store: new ProfileStore(context.appDataRoot, deps.cipher),
		openExternal: (url) => deps.openExternal(url),
		readStats: async (picked, catalog) => {
			const setup = await readAgentSetup(
				deps.claudeFiles(),
				liveFolders().map(({ path }) => path),
			);
			return readPublishedStats(db, new Date(), picked, visibility, catalogNames(catalog, setup));
		},
		githubLogin: async () => (await github())?.login ?? null,
		changed: (state) => events.emit(STATS_PROFILE_CHANGED_CHANNEL, state),
	});
	commands.define('stats.profile', () => profile.profile());
	commands.define('stats.sign-in', () => profile.signIn());
	commands.define('stats.cancel-sign-in', () => profile.cancelSignIn());
	commands.define('stats.publish', (args: unknown) =>
		profile.publish(requiredText(args, 'handle')),
	);
	commands.define('stats.unpublish', () => profile.unpublish());
	commands.define('stats.sign-out', () => profile.signOut());
	commands.define('stats.pick-repositories', (args: unknown) => {
		const repositories = isRecord(args) ? args['repositories'] : undefined;
		if (!Array.isArray(repositories)) {
			throw new Error('invalid args: `repositories` must be an array of repository names');
		}
		return profile.pick(repositories);
	});
	commands.define('stats.share-part', (args: unknown) => {
		const { part, on } = sharePartArgs(args);
		return profile.share(part, on);
	});
	commands.define('stats.public-repositories', () =>
		readPublicRepositories(db, new Date(), visibility),
	);
	commands.define('stats.share-card', async (): Promise<ShareCard> => {
		const [stats, identity] = await Promise.all([
			readPublishedStats(db, new Date(), [], NOT_PUBLIC, catalogNames(null, NO_SETUP)),
			github(),
		]);
		const state = profile.state();
		const avatar = identity
			? await commands
					.call('repositories.owner-avatar', { owner: identity.login })
					.catch(() => null)
			: null;
		return {
			stats,
			name: identity?.name ?? identity?.login ?? null,
			handle: state.publishing === 'on' ? (state.profile?.handle ?? null) : null,
			avatar: avatar ? `data:${avatar.mediaType};base64,${avatar.base64}` : null,
		};
	});

	return {
		openUrl: (url) => void profile.completeSignIn(url),
		start: () => {
			profile.start();
			sampler.start();
			running.start();
			void running.stopLeftovers({
				folders: [{ id: 'workstreams', path: workstreamsRoot(context.appDataRoot) }],
				live: liveFolders(),
			});
		},
		stop: () => {
			profile.stop();
			sampler.stop();
			running.stop();
		},
		stopWorkstreamLeftovers: (workstreamId) => {
			const live = liveFolders();
			return running.stopLeftovers({
				folders: live.filter(({ id }) => id === workstreamId),
				live: live.filter(({ id }) => id !== workstreamId),
			});
		},
	};
}

function requiredText(args: unknown, key: string): string {
	const value = isRecord(args) ? args[key] : undefined;
	if (typeof value !== 'string') throw new Error(`invalid args: \`${key}\` must be a string`);
	return value;
}

function sharePartArgs(args: unknown): SharePartArgs {
	const part = isRecord(args) ? args['part'] : undefined;
	const on = isRecord(args) ? args['on'] : undefined;
	const known = STATS_PARTS.find((name) => name === part);
	if (!known) throw new Error(`invalid args: \`part\` must be one of ${STATS_PARTS.join(', ')}`);
	if (typeof on !== 'boolean') throw new Error('invalid args: `on` must be a boolean');
	return { part: known, on };
}

function stopRunningArgs(args: unknown): StopRunningArgs {
	const workstreamId = isRecord(args) ? args['workstreamId'] : undefined;
	const itemIds = isRecord(args) ? args['itemIds'] : undefined;
	if (typeof workstreamId !== 'string' || workstreamId === '') {
		throw new Error('invalid args: `workstreamId` must be a non-empty string');
	}
	if (!Array.isArray(itemIds) || !itemIds.every((id): id is string => typeof id === 'string')) {
		throw new Error('invalid args: `itemIds` must be an array of strings');
	}
	return { workstreamId, itemIds };
}

export function readActivity(db: MaliniDatabase, now: Date): ActivityStats {
	const fullNames = repositoryFullNames(db);
	return summarizeActivity(
		listRunActivity(db).map((entry) => ({
			date: entry.date,
			fullName: fullNames.get(entry.projectId) ?? entry.projectId,
			runs: entry.runs,
			jobRuns: entry.jobRuns,
			seconds: entry.seconds,
		})),
		localDate(now),
		listOpenRuns(db).length,
	);
}

function memoryJournal(appDataRoot: string): (entry: MemoryJournalEntry) => void {
	let failureReported = false;
	return (entry) => {
		try {
			appendNdjsonRecord(appDataRoot, MEMORY_LOG_STEM, entry, MAX_MEMORY_LOG_BYTES);
		} catch (error) {
			if (failureReported) return;
			failureReported = true;
			console.warn(`malini: the memory journal is not writable: ${thrownDetail(error).reason}`);
		}
	};
}

function repositoryFullNames(db: MaliniDatabase): Map<string, string> {
	const fullNames = new Map<string, string>();
	for (const repository of listConnectedRepositories(db)) {
		const projectId = managedProjectIdForRepository(repository);
		if (projectId) fullNames.set(projectId, repository.fullName);
	}
	return fullNames;
}
