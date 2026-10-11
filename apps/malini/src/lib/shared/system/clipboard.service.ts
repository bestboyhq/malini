import { invoke } from '$shared/port/invoke';

class ClipboardService {
	write(text: string, html?: string): Promise<void> {
		return invoke('app.copy-text', html === undefined ? { text } : { text, html });
	}
}

export const clipboardService = new ClipboardService();
