import type { AgentElementReference } from './agent';

export const BROWSER_WORKTREE_SCHEME = 'malini-worktree';

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
	element: AgentElementReference;
	screenshot: BrowserScreenshot;
}>;

export type BrowserShowArgs = BrowserTabArgs & Readonly<{ bounds: BrowserBounds }>;

export type BrowserNavigateArgs = BrowserTabArgs & Readonly<{ url: string }>;
