import type { BrowserTabArgs } from '$contract/browser';

export interface BrowserPageInfo {
	readonly url: string;
	readonly title: string;
}

export interface BrowserScreenshotFile {
	readonly path: string;
	readonly previewPath: string;
	readonly url: string;
	readonly pageHeight?: number;
}

export interface BrowserScreenshotPart {
	readonly selector?: string;
	readonly fullPage: boolean;
}

export interface BrowserConsoleLine {
	readonly level: 'debug' | 'info' | 'warning' | 'error';
	readonly text: string;
	readonly source: string;
}

export interface BrowserConsole {
	readonly url: string;
	readonly lines: readonly BrowserConsoleLine[];
	readonly dropped: number;
}

export interface BrowserScrollPosition {
	readonly x: number;
	readonly y: number;
	readonly height: number;
	readonly container?: string;
}

export interface BrowserWait {
	readonly seconds: number;
	readonly gone: boolean;
	readonly text?: string;
	readonly selector?: string;
}

export interface BrowserSize {
	readonly width: number;
	readonly height: number;
}

export interface BrowserDialog {
	readonly type: 'alert' | 'confirm';
	readonly message: string;
}

export interface BrowserDialogAnswer {
	readonly dialog: BrowserDialog;
	readonly accepted: boolean;
	readonly page: BrowserPageInfo;
}

export class BrowserDialogOpen extends Error {
	constructor(
		readonly dialog: BrowserDialog,
		readonly openedByAction: boolean,
	) {
		super(waitingDialog(dialog));
	}
}

function waitingDialog({ type, message }: BrowserDialog): string {
	const says = `The page shows ${type === 'alert' ? 'an alert' : 'a confirm dialog'} and waits for an answer: ${JSON.stringify(message)}.`;
	return type === 'alert'
		? `${says} Call browser_dialog to close it.`
		: `${says} Call browser_dialog with accept true to press OK, or false to press Cancel.`;
}

export interface BrowserTabProcess {
	readonly processId: number;
	readonly title: string;
	readonly shown: boolean;
}

export interface BrowserPlatform {
	open(tab: BrowserTabArgs, url: string): Promise<BrowserPageInfo>;
	readPage(tab: BrowserTabArgs): Promise<string>;
	screenshot(
		tab: BrowserTabArgs,
		worktree: string,
		part: BrowserScreenshotPart,
	): Promise<BrowserScreenshotFile>;
	click(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo>;
	hover(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo>;
	type(
		tab: BrowserTabArgs,
		selector: string,
		text: string,
		submit: boolean,
	): Promise<BrowserPageInfo>;
	press(tab: BrowserTabArgs, key: string): Promise<BrowserPageInfo>;
	scroll(
		tab: BrowserTabArgs,
		by: { readonly x: number; readonly y: number; readonly selector?: string },
	): Promise<BrowserScrollPosition>;
	wait(tab: BrowserTabArgs, until: BrowserWait): Promise<BrowserPageInfo>;
	evaluate(tab: BrowserTabArgs, script: string): Promise<string>;
	consoleLines(tab: BrowserTabArgs): Promise<BrowserConsole>;
	goBack(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	goForward(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	reload(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	resize(tab: BrowserTabArgs, width: number, height?: number): Promise<BrowserSize>;
	upload(
		tab: BrowserTabArgs,
		worktree: string,
		selector: string,
		paths: readonly string[],
	): Promise<BrowserPageInfo>;
	answerDialog(tab: BrowserTabArgs, accept: boolean): Promise<BrowserDialogAnswer>;
	close(tab: BrowserTabArgs): Promise<boolean>;
	tabProcesses(): BrowserTabProcess[];
}
