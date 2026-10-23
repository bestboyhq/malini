import type { AgentTheme } from '$contract/agent';
import type { SkillRecord, TurnedOffSkills } from '$contract/skills';
import type { MainContext } from '$main/context';
import type { CheckoutResolver } from '$shared/repositories/repositories.platform';
import { chatNamingJob, serviceNamingJob } from '$lib/jobs/jobs.platform';
import { stopBackgroundTask, stopWorkstreamBackgroundCommands } from './agent/commands';
import type { AgentRunLeases } from './agent/lifecycle';
import type { BridgeProcessFactory } from './agent/process';
import { startAgentService, type AgentService, type BrowserAutomation } from './agent/service';
import { installAttachments, type WorkstreamCheckoutResolver } from './attachments/commands';
import type { FilePicker } from './attachments/picker';
import { ensureAppManagedGitExcludes } from '$main/git/excludes';
import { stagedAttachmentExpiryFrom } from './attachments.repository';
import {
	attachmentIdsToSend,
	gcStaged,
	prepareAttachmentsToSend,
	verifyStagedFile,
} from './attachments/service';
import { installCheckpoints } from './checkpoints/commands';
import { installPermissionGrants } from './grants/commands';
import { defineMcpServerCommands } from './mcp-servers';

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
		},
		...(deps.log ? { log: deps.log } : {}),
		...(deps.theme ? { theme: deps.theme } : {}),
		...(deps.browser ? { browser: deps.browser } : {}),
		...(deps.processFactory ? { processFactory: deps.processFactory } : {}),
		...(deps.bridgeScriptPath ? { bridgeScriptPath: deps.bridgeScriptPath } : {}),
	});

	defineMcpServerCommands(context.commands, {
		runtime: agent.runtime,
		claudeSettings: deps.claudeSettings,
		resolveWorkstreamCheckout: deps.resolveWorkstreamCheckout,
	});

	return {
		closeOpenRunsForExit: () => agent.closeOpenRunsForExit(),
		stop: () => {
			stopGrants();
			return agent.stop();
		},
		listSkills: async (cwd, turnedOff) => (await agent.ensureReady()).listSkills(cwd, turnedOff),
		bridgeProcessId: () => {
			const health = agent.health();
			return health.state === 'healthy' ? health.pid : null;
		},
		stopBackgroundTask: (sessionId, taskId) =>
			stopBackgroundTask(context.db, agent.runtime, sessionId, taskId),
		stopWorkstreamBackgroundCommands: (workstreamId) =>
			stopWorkstreamBackgroundCommands(context.db, agent.runtime, workstreamId),
		nameService: async (task) =>
			(await agent.ensureReady()).suggestTitle(task, serviceNamingJob(context.db)),
		nameWorkstream: async (task) =>
			(await agent.ensureReady()).suggestTitle(task, chatNamingJob(context.db)),
	};
}
