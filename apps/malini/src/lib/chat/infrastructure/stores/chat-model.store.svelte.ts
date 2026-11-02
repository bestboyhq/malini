import {
	DEFAULT_AGENT_RUN_PROFILE,
	DEFAULT_PROVIDER_ID,
	defaultAgentModel,
	isValidAgentModel,
	type AgentRunProfile,
	type ChatSetup,
	type ModelSelection,
} from '$shared/providers/providers.api';
import type { SessionId } from '$lib/chat/domain/session';

class ChatModelStore {
	selection: ModelSelection | null = $state(null);
	profile: AgentRunProfile = $state({ ...DEFAULT_AGENT_RUN_PROFILE });
	preview: Readonly<{
		sessionId: SessionId;
		selection: ModelSelection;
		profile: AgentRunProfile;
	}> | null = $state.raw(null);
	userChoices = 0;

	noteUserChoice(): void {
		this.userChoices += 1;
	}

	show(setup: ChatSetup): void {
		this.selection = { ...setup.selection };
		this.profile = { ...setup.profile };
	}

	setup(): ChatSetup {
		return { selection: this.currentSelection(), profile: { ...this.profile } };
	}

	adoptPreview(sessionId: SessionId | null): SessionId | null {
		const preview = this.previewFor(sessionId);
		if (!preview) return null;
		this.show(preview);
		this.preview = null;
		return preview.sessionId;
	}

	previewFor(sessionId: SessionId | null): ChatModelStore['preview'] {
		return sessionId !== null && this.preview?.sessionId === sessionId ? this.preview : null;
	}

	currentSelection(): ModelSelection {
		return this.selection ?? { provider: DEFAULT_PROVIDER_ID, model: defaultAgentModel() };
	}

	selectionForSession(record: { provider: string | null; model: string | null }): ModelSelection {
		if (isValidAgentModel(record.model)) {
			return { provider: record.provider ?? DEFAULT_PROVIDER_ID, model: record.model };
		}
		return { provider: DEFAULT_PROVIDER_ID, model: defaultAgentModel() };
	}
}

export const chatModelStore = new ChatModelStore();
