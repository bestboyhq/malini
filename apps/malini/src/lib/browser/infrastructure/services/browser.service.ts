import type {
	BrowserBounds,
	BrowserElementPrompt,
	BrowserState,
	BrowserTabArgs,
} from '$contract/browser';
import { BROWSER_STATE_CHANGED_CHANNEL, BROWSER_TAB_OPENED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class BrowserService {
	state(tab: BrowserTabArgs): Promise<BrowserState> {
		return invoke('browser.state', tab);
	}

	onStateChanged(listener: (state: BrowserState) => void): () => void {
		return onPlatformEvent(BROWSER_STATE_CHANGED_CHANNEL, listener);
	}

	onTabOpened(listener: (tab: BrowserTabArgs) => void): () => void {
		return onPlatformEvent(BROWSER_TAB_OPENED_CHANNEL, listener);
	}

	show(tab: BrowserTabArgs, bounds: BrowserBounds): Promise<void> {
		return invoke('browser.show', { ...tab, bounds });
	}

	hide(tab: BrowserTabArgs): Promise<void> {
		return invoke('browser.hide', tab);
	}

	snapshot(tab: BrowserTabArgs): Promise<string | null> {
		return invoke('browser.snapshot', tab);
	}

	navigate(tab: BrowserTabArgs, url: string): Promise<void> {
		return invoke('browser.navigate', { ...tab, url });
	}

	goBack(tab: BrowserTabArgs): Promise<void> {
		return invoke('browser.go-back', tab);
	}

	goForward(tab: BrowserTabArgs): Promise<void> {
		return invoke('browser.go-forward', tab);
	}

	reload(tab: BrowserTabArgs): Promise<void> {
		return invoke('browser.reload', tab);
	}

	pickElement(tab: BrowserTabArgs): Promise<BrowserElementPrompt | null> {
		return invoke('browser.pick-element', tab);
	}

	cancelPick(tab: BrowserTabArgs): Promise<void> {
		return invoke('browser.cancel-pick', tab);
	}

	close(tab: BrowserTabArgs): Promise<void> {
		return invoke('browser.close', tab);
	}
}

export const browserService = new BrowserService();
