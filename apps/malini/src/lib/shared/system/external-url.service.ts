import { invoke } from '$shared/port/invoke';

class ExternalUrlService {
	open(url: string): Promise<void> {
		return invoke('app.open-external-url', { url });
	}
}

export const externalUrlService = new ExternalUrlService();
