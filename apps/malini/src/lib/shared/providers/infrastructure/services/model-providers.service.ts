import type { ChatGptSignInOutcome, ModelProviderRecord } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class ModelProvidersService {
	list(): Promise<ModelProviderRecord[]> {
		return invoke('providers.list', undefined);
	}

	refreshModels(): Promise<ModelProviderRecord[]> {
		return invoke('providers.refresh-models', undefined);
	}

	saveKey(providerId: string, apiKey: string): Promise<void> {
		return invoke('providers.save-key', { providerId, apiKey });
	}

	checkPlan(providerId: string): Promise<void> {
		return invoke('providers.check-plan', { providerId });
	}

	deleteKey(providerId: string): Promise<void> {
		return invoke('providers.delete-key', { providerId });
	}

	signInToChatGpt(): Promise<ChatGptSignInOutcome> {
		return invoke('providers.sign-in-to-chatgpt', undefined);
	}

	cancelChatGptSignIn(): Promise<void> {
		return invoke('providers.cancel-chatgpt-sign-in', undefined);
	}

	signOutOfChatGpt(): Promise<void> {
		return invoke('providers.sign-out-of-chatgpt', undefined);
	}
}

export const modelProvidersService = new ModelProvidersService();
