import type { ActivityStats } from '$contract/stats';
import { STATS_RESOURCES_SAMPLED_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
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

export interface StatsDeps {
	readonly runner: ProcessRunner;
	browserTabs(): readonly BrowserTab[];
	agentHostProcessId(): number | null;
	runningContainerIds(): Promise<string[]>;
}

export interface StatsPlatform {
	start(): void;
	stop(): void;
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
	});

	commands.define('stats.resources', () => sampler.history());
	commands.define('stats.resource-breakdown', () => sampler.breakdown());
	commands.define('stats.activity', () => readActivity(db, new Date()));

	return {
		start: () => sampler.start(),
		stop: () => sampler.stop(),
	};
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

function repositoryFullNames(db: MaliniDatabase): Map<string, string> {
	const fullNames = new Map<string, string>();
	for (const repository of listConnectedRepositories(db)) {
		const projectId = managedProjectIdForRepository(repository);
		if (projectId) fullNames.set(projectId, repository.fullName);
	}
	return fullNames;
}
