import { tick } from 'svelte';
import { errorMessage } from '$lib/chat/domain/error-message';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { chatBootstrap } from '$lib/chat/infrastructure/services/chat-bootstrap.service';
import { chatRouteSync } from '$lib/chat/infrastructure/services/chat-route-sync.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

class AgentRecoveryService {
	async resetStuckRuns(workstreamId: string): Promise<boolean> {
		if (!workstreamId || chatSessionStore.resettingRuns) return false;
		chatSessionStore.resettingRuns = true;
		try {
			const closed = await agentSessions.resetWorkstreamRuns(workstreamId);
			toast.info(
				closed > 0
					? `Reset ${closed} stuck run${closed === 1 ? '' : 's'}.`
					: 'No stuck runs found.',
				aboutWorkstream(workstreamId),
			);
			return true;
		} catch (error) {
			toast.error(errorMessage(error, 'Failed to reset stuck runs'), aboutWorkstream(workstreamId));
			return false;
		} finally {
			chatSessionStore.resettingRuns = false;
		}
	}

	async restartAgentProcess(): Promise<void> {
		const deadOwner = sessionActivation.activeRunOwner();
		if (!deadOwner || !(await this.resetStuckRuns(deadOwner.workstreamId))) return;
		chatSessionStore.retryingSession = true;
		try {
			await agentSessions.restartAgent();
			if (
				chatSessionStore.sessionId === deadOwner.sessionId &&
				chatRoute.isCurrentWorkstream(deadOwner.workstreamId)
			) {
				chatSessionStore.sessionId = null;
				chatSessionStore.bootError = null;
				const seq = chatSessionStore.nextBootstrapSeq();
				await chatBootstrap.run(deadOwner.workstreamId, seq, deadOwner.sessionId);
				if (
					seq === chatSessionStore.bootstrapSeq &&
					chatRoute.isCurrentWorkstream(deadOwner.workstreamId) &&
					chatSessionStore.bootError
				) {
					throw new Error(chatSessionStore.bootError);
				}
			}
			agentRunner.clearBridgeDead(deadOwner);
			toast.info('Agent process restarted');
		} catch (error) {
			const message = errorMessage(error, 'Agent process restart failed');
			if (chatRoute.isCurrentWorkstream(deadOwner.workstreamId)) {
				chatSessionStore.bootError = message;
			}
			toast.error(message);
		} finally {
			chatSessionStore.retryingSession = false;
		}
	}

	async retryChat(): Promise<void> {
		const workstreamId = chatRoute.workstreamId;
		if (!workstreamId || chatSessionStore.retryingSession) return;
		chatSessionStore.retryingSession = true;
		chatSessionStore.sessionId = null;
		chatSessionStore.bootError = null;
		try {
			await chatBootstrap.run(workstreamId, chatSessionStore.nextBootstrapSeq());
		} finally {
			chatSessionStore.retryingSession = false;
		}
	}

	async startFreshChat(): Promise<boolean> {
		const workstreamId = chatRoute.workstreamId;
		const currentSessionId = chatSessionStore.sessionId ?? chatRoute.readSessionParam();
		if (!currentSessionId || !workstreamId) return false;
		chatSessionStore.suppressRouteActivation = true;
		try {
			const selection = chatSessionStore.beginSelection(workstreamId, null);
			chatSessionStore.finishSelection(selection);
			chatSessionStore.freshReturnSessionId = currentSessionId;
			chatSessionStore.sessionId = null;
			chatSessionStore.createFreshSessionOnNextPrompt = true;
			chatSessionStore.emptySessionMode = 'fresh';
			chatSessionStore.bootError = null;
			await chatRouteSync.clearSessionUrl();
			sessionActivation.commitSessionlessPresentation(workstreamId, selection);
			await tick();
		} finally {
			chatSessionStore.suppressRouteActivation = false;
		}
		return true;
	}
}

export const agentRecovery = new AgentRecoveryService();
