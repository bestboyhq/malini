import { invoke } from '$shared/port/invoke';

class ClipboardService {
	write(text: string): Promise<void> {
		return invoke('app.copy-text', { text });
	}

	writeImage(pngDataUrl: string): Promise<void> {
		return invoke('app.copy-image', { pngDataUrl });
	}
}

export const clipboardService = new ClipboardService();
