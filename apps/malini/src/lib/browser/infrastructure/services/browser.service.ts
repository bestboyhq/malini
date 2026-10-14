import type {
	BrowserBounds,
	BrowserElementPrompt,
	BrowserPageOpened,
	BrowserState,
} from '$contract/browser';
import { BROWSER_PAGE_OPENED_CHANNEL, BROWSER_STATE_CHANGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class BrowserService {
	state(workstreamId: string): Promise<BrowserState> {
		return invoke('browser.state', { workstreamId });
	}

	onStateChanged(listener: (state: BrowserState) => void): () => void {
		return onPlatformEvent(BROWSER_STATE_CHANGED_CHANNEL, listener);
	}

	onPageOpened(listener: (opened: BrowserPageOpened) => void): () => void {
		return onPlatformEvent(BROWSER_PAGE_OPENED_CHANNEL, listener);
	}

	show(workstreamId: string, bounds: BrowserBounds): Promise<void> {
		return invoke('browser.show', { workstreamId, bounds });
	}

	hide(workstreamId: string): Promise<void> {
		return invoke('browser.hide', { workstreamId });
	}

	snapshot(workstreamId: string): Promise<string | null> {
		return invoke('browser.snapshot', { workstreamId });
	}

	navigate(workstreamId: string, url: string): Promise<void> {
		return invoke('browser.navigate', { workstreamId, url });
	}

	goBack(workstreamId: string): Promise<void> {
		return invoke('browser.go-back', { workstreamId });
	}

	goForward(workstreamId: string): Promise<void> {
		return invoke('browser.go-forward', { workstreamId });
	}

	reload(workstreamId: string): Promise<void> {
		return invoke('browser.reload', { workstreamId });
	}

	pickElement(workstreamId: string): Promise<BrowserElementPrompt | null> {
		return invoke('browser.pick-element', { workstreamId });
	}

	cancelPick(workstreamId: string): Promise<void> {
		return invoke('browser.cancel-pick', { workstreamId });
	}

	close(workstreamId: string): Promise<void> {
		return invoke('browser.close', { workstreamId });
	}
}

export const browserService = new BrowserService();
