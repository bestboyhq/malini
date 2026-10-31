import type {
	DeleteSecretArgs,
	SavedSecret,
	SaveSecretsArgs,
	SecretRequest,
} from '$contract/secrets';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

type ClosedRequest = Readonly<{ requestId: string; sessionId: string }>;

class SecretsService {
	listRequests(sessionId: string): Promise<SecretRequest[]> {
		return invoke('secrets.list-requests', { sessionId });
	}

	async save(args: SaveSecretsArgs): Promise<void> {
		await invoke('secrets.save', args);
	}

	async dismiss(requestId: string): Promise<void> {
		await invoke('secrets.dismiss-request', { requestId });
	}

	list(): Promise<SavedSecret[]> {
		return invoke('secrets.list', undefined);
	}

	async remove(args: DeleteSecretArgs): Promise<void> {
		await invoke('secrets.delete', args);
	}

	onRequested(listener: (request: SecretRequest) => void): () => void {
		return onPlatformEvent('secrets:requested', ({ request }) => listener(request));
	}

	onRequestClosed(listener: (closed: ClosedRequest) => void): () => void {
		const stopSaved = onPlatformEvent('secrets:saved', ({ requestId, sessionId }) => {
			if (requestId !== null && sessionId !== null) listener({ requestId, sessionId });
		});
		const stopDismissed = onPlatformEvent('secrets:request-dismissed', listener);
		return () => {
			stopSaved();
			stopDismissed();
		};
	}

	onSavedChanged(listener: () => void): () => void {
		const stopSaved = onPlatformEvent('secrets:saved', () => listener());
		const stopDeleted = onPlatformEvent('secrets:deleted', () => listener());
		return () => {
			stopSaved();
			stopDeleted();
		};
	}
}

export const secretsService = new SecretsService();
