import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import { errorMessage } from '$lib/chat/domain/error-message';
import { clipboardService as clipboard } from '$shared/system/clipboard.service';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';

export { copyTextCommand };

function copyTextCommand(request: Readonly<{ requestId: ChatRequestId; text: string }>): void {
	chatRequestsStore.begin(request.requestId);
	void (async () => {
		try {
			await clipboard.write(request.text);
			chatRequestsStore.accept(request.requestId);
		} catch (error) {
			chatRequestsStore.fail(request.requestId, errorMessage(error, 'Could not copy'));
		}
	})();
}
