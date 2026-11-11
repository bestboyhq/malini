import type { AgentElementReference, AgentRunProfile } from './agent';

export const BROWSER_WORKTREE_SCHEME = 'malini-worktree';

const PAGE_STILL_PARAM = 'malini-still';

export function worktreePageUrl(workstreamId: string, path: string): string {
	return new URL(path, `${BROWSER_WORKTREE_SCHEME}://${workstreamId.toLowerCase()}/`).href;
}

export function pageStillUrl(workstreamId: string, path: string): string {
	const url = new URL(worktreePageUrl(workstreamId, path));
	url.searchParams.set(PAGE_STILL_PARAM, url.hash);
	url.hash = '';
	return url.href;
}

export function stillPageUrl(stillUrl: string): string | null {
	const url = new URL(stillUrl);
	const hash = url.searchParams.get(PAGE_STILL_PARAM);
	if (hash === null) return null;
	url.searchParams.delete(PAGE_STILL_PARAM);
	url.hash = hash;
	return url.href;
}

export type BrowserBounds = Readonly<{ x: number; y: number; width: number; height: number }>;

export type BrowserTabArgs = Readonly<{ workstreamId: string; tabId: string }>;

export type BrowserState = Readonly<{
	workstreamId: string;
	tabId: string;
	url: string;
	title: string;
	favicon: string | null;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	failure: string | null;
}>;

export type BrowserScreenshot = Readonly<{ mediaType: 'image/png'; base64: string }>;

export type BrowserElementPrompt = Readonly<{
	prompt: string;
	provider: string;
	model: string;
	element: AgentElementReference;
	screenshot: BrowserScreenshot;
}>;

export type BrowserPickModel = Readonly<{
	id: string;
	label: string;
	provider: string;
	providerName: string;
}>;

export type BrowserPickArgs = BrowserTabArgs &
	Readonly<{
		provider: string;
		model: string;
		models: readonly BrowserPickModel[];
		profile: AgentRunProfile;
	}>;

export type BrowserThreadStarted = Readonly<{
	sessionId: string;
	provider: string;
	model: string;
}>;

export type BrowserThreadOpened = Readonly<{ workstreamId: string; sessionId: string }>;

export type BrowserShowArgs = BrowserTabArgs & Readonly<{ bounds: BrowserBounds }>;

export type BrowserNavigateArgs = BrowserTabArgs & Readonly<{ url: string }>;

export type BrowserResizeRequest = BrowserTabArgs & Readonly<{ requestId: string; width: number }>;

export type BrowserResizedArgs = Readonly<{ requestId: string }>;
