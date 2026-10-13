export interface BrowserPageInfo {
	readonly url: string;
	readonly title: string;
}

export interface BrowserScreenshotFile {
	readonly path: string;
	readonly previewPath: string;
	readonly url: string;
}

export interface BrowserPlatform {
	open(workstreamId: string, url: string): Promise<BrowserPageInfo>;
	screenshot(workstreamId: string, worktree: string): Promise<BrowserScreenshotFile>;
	click(workstreamId: string, selector: string): Promise<BrowserPageInfo>;
}
