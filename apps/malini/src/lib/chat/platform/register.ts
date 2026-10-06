import type { MainContext } from '$main/context';
import type { CheckoutResolver } from '$shared/repositories/repositories.platform';
import type { AgentRunLeases } from './agent/lifecycle';
import type { BridgeProcessFactory } from './agent/process';
import { startAgentService, type AgentService } from './agent/service';
import { installAttachments, type WorkstreamCheckoutResolver } from './attachments/commands';
import type { FilePicker } from './attachments/picker';
import { gcStaged, verifyStagedFile } from './attachments/service';
import { installCheckpoints } from './checkpoints/commands';
import { getSession } from './sessions.repository';

export interface ChatDeps {
	readonly resolver: CheckoutResolver;
	readonly leases: AgentRunLeases;
	readonly resolveWorkstreamCheckout: WorkstreamCheckoutResolver;
	readonly spawnEnvironment: () => Readonly<Record<string, string>>;
	readonly picker?: FilePicker;
	readonly processFactory?: BridgeProcessFactory;
	readonly bridgeScriptPath?: string;
	readonly log?: (line: string) => void;
}

export interface ChatPlatform {
	closeOpenRunsForExit(): Promise<number>;
	stop(): Promise<void>;
	sessionModel(sessionId: string): string | null;
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
		hooks: {
			captureCheckpoint: ({ workstreamId, sessionId, runId }) =>
				checkpoints.captureRunStart({ workstreamId, sessionId, runId }),
			onRunFinished: async ({ runId }) => {
				await checkpoints.captureRunFinish(runId);
			},
		},
		...(deps.log ? { log: deps.log } : {}),
		...(deps.processFactory ? { processFactory: deps.processFactory } : {}),
		...(deps.bridgeScriptPath ? { bridgeScriptPath: deps.bridgeScriptPath } : {}),
	});

	return {
		closeOpenRunsForExit: () => agent.closeOpenRunsForExit(),
		stop: () => agent.stop(),
		sessionModel: (sessionId) => getSession(context.db, sessionId)?.model ?? null,
	};
}
