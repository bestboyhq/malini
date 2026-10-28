import type { AgentTheme } from '$contract/agent';
import { APP_STARTED_CHANNEL, JOBS_TIME_REACHED_CHANNEL } from '$contract/events';
import type { ShipFailure } from '$contract/pull-requests';
import type { SkillRecord, TurnedOffSkills } from '$contract/skills';
import type { MainContext } from '$main/context';
import type { CheckoutResolver } from '$shared/repositories/repositories.platform';
import {
	runAutomaticJob,
	type ChooseWithJob,
	type DispatchedEvent,
	type SuggestWithJob,
} from '$lib/jobs/jobs.platform';
import { stopBackgroundTask, stopWorkstreamBackgroundCommands } from './agent/commands';
import type { AgentRunLeases } from './agent/lifecycle';
import type { BridgeProcessFactory } from './agent/process';
import { startAgentService, type AgentService, type BrowserAutomation } from './agent/service';
import { installAttachments, type WorkstreamCheckoutResolver } from './attachments/commands';
import type { FilePicker } from './attachments/picker';
import { isRecord } from '$main/db/rows';
import { ensureAppManagedGitExcludes } from '$main/git/excludes';
import { stagedAttachmentExpiryFrom } from './attachments.repository';
import {
	attachmentIdsToSend,
	gcStaged,
	prepareAttachmentsToSend,
	verifyStagedFile,
} from './attachments/service';
import { installCheckpoints } from './checkpoints/commands';
import { packArchivedChats } from './event-packs.service';
import { installPermissionGrants } from './grants/commands';
import { defineMcpServerCommands, type McpServerListings } from './mcp-servers';
import { installShellRuns } from './shell-runs/commands';

export interface ChatDeps {
	readonly resolver: CheckoutResolver;
	readonly leases: AgentRunLeases;
	readonly resolveWorkstreamCheckout: WorkstreamCheckoutResolver;
	readonly spawnEnvironment: () => Readonly<Record<string, string>>;
	readonly claudeSettings: () => string;
	readonly picker?: FilePicker;
	readonly browser?: BrowserAutomation;
	readonly processFactory?: BridgeProcessFactory;
	readonly bridgeScriptPath?: string;
	readonly theme?: () => AgentTheme;
	readonly shippingFailure?: (workstreamId: string) => ShipFailure | null;
	readonly log?: (line: string) => void;
}

export interface ChatPlatform {
	closeOpenRunsForExit(): Promise<number>;
	stop(): Promise<void>;
	listSkills(cwd: string, turnedOff: TurnedOffSkills): Promise<SkillRecord[]>;
	bridgeProcessId(): number | null;
	stopBackgroundTask(sessionId: string, taskId: string): Promise<void>;
	stopWorkstreamBackgroundCommands(workstreamId: string): Promise<void>;
	nameService(task: string): Promise<string>;
	nameWorkstream(task: string): Promise<string>;
	suggestTitle: SuggestWithJob;
	choose: ChooseWithJob;
	resume(event: DispatchedEvent): Promise<void>;
}

export async function registerChat(context: MainContext, deps: ChatDeps): Promise<ChatPlatform> {
	const checkpoints = installCheckpoints(context, {
		resolver: deps.resolver,
		leases: deps.leases,
	});

	installAttachments(context, {
		resolveWorkstreamCheckout: deps.resolveWorkstreamCheckout,
		...(deps.picker ? { picker: deps.picker } : {}),
	});
	const stopGrants = installPermissionGrants(context);
	const shellRuns = installShellRuns(context, {
		checkout: deps.resolveWorkstreamCheckout,
		environment: deps.spawnEnvironment,
	});
	const packing = packArchivedChats(context);
	let mcpServers: McpServerListings | null = null;

	const agent: AgentService = await startAgentService(context, {
		leases: deps.leases,
		spawnEnvironment: deps.spawnEnvironment,
		verifyAttachment: (stored, worktree) => verifyStagedFile(worktree, stored),
		collectAttachmentGarbage: (workstreamId, worktree, now) => {
			gcStaged(context.db, worktree, workstreamId, now);
		},
		prepareAttachments: async (input) => {
			if (attachmentIdsToSend(input.prompt, input.attachmentIds).length === 0) {
				return { prompt: input.prompt, attachmentIds: [] };
			}
			await ensureAppManagedGitExcludes(input.worktree);
			const now = new Date();
			return prepareAttachmentsToSend(
				context.db,
				deps.resolveWorkstreamCheckout,
				input,
				now.toISOString(),
				stagedAttachmentExpiryFrom(now),
			);
		},
		hooks: {
			captureCheckpoint: ({ workstreamId, sessionId, runId }) =>
				checkpoints.captureRunStart({ workstreamId, sessionId, runId }),
			onRunFinished: async ({ runId }) => {
				await checkpoints.captureRunFinish(runId);
			},
			onMcpServers: (listing) => mcpServers?.received(listing),
		},
		...(deps.log ? { log: deps.log } : {}),
		...(deps.theme ? { theme: deps.theme } : {}),
		...(deps.shippingFailure ? { shippingFailure: deps.shippingFailure } : {}),
		shellRuns: (sessionId) => shellRuns.report(sessionId),
		...(deps.browser ? { browser: deps.browser } : {}),
		...(deps.processFactory ? { processFactory: deps.processFactory } : {}),
		...(deps.bridgeScriptPath ? { bridgeScriptPath: deps.bridgeScriptPath } : {}),
	});

	mcpServers = defineMcpServerCommands(context.commands, {
		db: context.db,
		events: context.events,
		runtime: agent.runtime,
		claudeSettings: deps.claudeSettings,
		resolveWorkstreamCheckout: deps.resolveWorkstreamCheckout,
		log: deps.log ?? (() => undefined),
	});

	const suggestTitle: SuggestWithJob = async (task, job) =>
		(await agent.ensureReady()).suggestTitle(task, job);
	let resumed = false;

	return {
		closeOpenRunsForExit: () => agent.closeOpenRunsForExit(),
		stop: async () => {
			stopGrants();
			await Promise.all([packing.stop(), agent.stop(), shellRuns.stopAll()]);
		},
		listSkills: async (cwd, turnedOff) => (await agent.ensureReady()).listSkills(cwd, turnedOff),
		bridgeProcessId: () => {
			const health = agent.health();
			return health.state === 'healthy' ? health.pid : null;
		},
		stopBackgroundTask: (sessionId, taskId) =>
			stopBackgroundTask(context.db, agent.runtime, sessionId, taskId),
		stopWorkstreamBackgroundCommands: async (workstreamId) => {
			await Promise.all([
				stopWorkstreamBackgroundCommands(context.db, agent.runtime, workstreamId),
				shellRuns.stopWorkstream(workstreamId),
			]);
		},
		nameService: (task) => runAutomaticJob(context.db, 'name-services', task, suggestTitle),
		nameWorkstream: (task) => runAutomaticJob(context.db, 'name-chats', task, suggestTitle),
		suggestTitle,
		choose: async (task, job, choices) => (await agent.ensureReady()).choose(task, job, choices),
		resume: async (event) => {
			if (event.channel === JOBS_TIME_REACHED_CHANNEL) {
				const paused = pausedRunReached(event.payload);
				if (paused) await agent.continuePausedRun(paused, event.id);
				return;
			}
			if (event.channel !== APP_STARTED_CHANNEL || resumed) return;
			resumed = true;
			await agent.continuePausedRuns(event.id);
		},
	};
}

function pausedRunReached(payload: unknown): Readonly<{ sessionId: string; runId: string }> | null {
	if (!isRecord(payload)) return null;
	const { wait, sessionId, runId } = payload;
	return wait === 'resume' && typeof sessionId === 'string' && typeof runId === 'string'
		? { sessionId, runId }
		: null;
}
