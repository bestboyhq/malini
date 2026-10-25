import type { ActivityStats, StopRunningArgs } from '$contract/stats';
import { STATS_RESOURCES_SAMPLED_CHANNEL } from '$contract/events';
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
import { ResourceSampler, type BrowserTab } from './resource-sampler';
import type { WorkstreamFolder } from './running-docker';
import { WorkstreamRunningMonitor } from './workstream-running';

export interface StatsDeps {
	readonly runner: ProcessRunner;
	browserTabs(): readonly BrowserTab[];
	agentHostProcessId(): number | null;
	runningContainerIds(): Promise<string[]>;
	stopBackgroundTask(sessionId: string, taskId: string): Promise<void>;
	nameService(task: string): Promise<string>;
}

export interface StatsPlatform {
	start(): void;
	stop(): void;
	stopWorkstreamLeftovers(workstreamId: string): Promise<void>;
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

	return {
		start: () => {
			sampler.start();
			running.start();
			void running.stopLeftovers({
				folders: [{ id: 'workstreams', path: workstreamsRoot(context.appDataRoot) }],
				live: liveFolders(),
			});
		},
		stop: () => {
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
