import type { ModelProviderRecord } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class ModelProvidersService {
	list(): Promise<ModelProviderRecord[]> {
		return invoke('providers.list', undefined);
	}

	saveKey(providerId: string, apiKey: string): Promise<void> {
		return invoke('providers.save-key', { providerId, apiKey });
	}

	deleteKey(providerId: string): Promise<void> {
		return invoke('providers.delete-key', { providerId });
	}
}

export const modelProvidersService = new ModelProvidersService();
