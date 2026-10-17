import type { BrowserTabArgs } from '$contract/browser';

export interface BrowserPageInfo {
	readonly url: string;
	readonly title: string;
}

export interface BrowserScreenshotFile {
	readonly path: string;
	readonly previewPath: string;
	readonly url: string;
}

export interface BrowserTabProcess {
	readonly processId: number;
	readonly title: string;
}

export interface BrowserPlatform {
	open(tab: BrowserTabArgs, url: string): Promise<BrowserPageInfo>;
	screenshot(tab: BrowserTabArgs, worktree: string): Promise<BrowserScreenshotFile>;
	click(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo>;
	type(
		tab: BrowserTabArgs,
		selector: string,
		text: string,
		submit: boolean,
	): Promise<BrowserPageInfo>;
	goBack(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	goForward(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	reload(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	tabProcesses(): BrowserTabProcess[];
}
