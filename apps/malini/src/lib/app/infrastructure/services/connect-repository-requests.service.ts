import {
	APP_CONNECT_REPOSITORY_REQUESTED_CHANNEL,
	type ConnectRepositoryRequest,
} from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class ConnectRepositoryRequestsService {
	onRequest(listener: (via: ConnectRepositoryRequest['via']) => void): () => void {
		let listening = true;
		const take = async (): Promise<void> => {
			const request = await invoke('app.take-connect-repository-request', undefined).catch(
				() => null,
			);
			if (listening && request) listener(request.via);
		};
		const stop = onPlatformEvent(APP_CONNECT_REPOSITORY_REQUESTED_CHANNEL, () => void take());
		void take();
		return () => {
			listening = false;
			stop();
		};
	}
}

export const connectRepositoryRequestsService = new ConnectRepositoryRequestsService();
