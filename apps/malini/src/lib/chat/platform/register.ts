import type { SkillRecord } from '$contract/skills';
import type { MainContext } from '$main/context';
import type { CheckoutResolver } from '$shared/repositories/repositories.platform';
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
import { getSession } from './sessions.repository';

export interface ChatDeps {
	readonly resolver: CheckoutResolver;
	readonly leases: AgentRunLeases;
	readonly resolveWorkstreamCheckout: WorkstreamCheckoutResolver;
	readonly spawnEnvironment: () => Readonly<Record<string, string>>;
	readonly picker?: FilePicker;
	readonly browser?: BrowserAutomation;
	readonly processFactory?: BridgeProcessFactory;
	readonly bridgeScriptPath?: string;
	readonly log?: (line: string) => void;
}

export interface ChatPlatform {
	closeOpenRunsForExit(): Promise<number>;
	stop(): Promise<void>;
	sessionModel(sessionId: string): string | null;
	listSkills(cwd: string): Promise<SkillRecord[]>;
	bridgeProcessId(): number | null;
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
		...(deps.browser ? { browser: deps.browser } : {}),
		...(deps.processFactory ? { processFactory: deps.processFactory } : {}),
		...(deps.bridgeScriptPath ? { bridgeScriptPath: deps.bridgeScriptPath } : {}),
	});

	return {
		closeOpenRunsForExit: () => agent.closeOpenRunsForExit(),
		stop: () => agent.stop(),
		sessionModel: (sessionId) => getSession(context.db, sessionId)?.model ?? null,
		listSkills: async (cwd) => (await agent.ensureReady()).listSkills(cwd),
		bridgeProcessId: () => {
			const health = agent.health();
			return health.state === 'healthy' ? health.pid : null;
		},
	};
}
