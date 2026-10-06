import { invoke } from '$shared/port/invoke';

class ClipboardService {
	write(text: string): Promise<void> {
		return invoke('app.copy-text', { text });
	}
}

export const clipboardService = new ClipboardService();
