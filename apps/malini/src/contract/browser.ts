import type { AgentElementReference } from './agent';

export type BrowserBounds = Readonly<{ x: number; y: number; width: number; height: number }>;

export type BrowserState = Readonly<{
	workstreamId: string;
	url: string;
	title: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
}>;

export type BrowserScreenshot = Readonly<{ mediaType: 'image/png'; base64: string }>;

export type BrowserElementPrompt = Readonly<{
	prompt: string;
	element: AgentElementReference;
	screenshot: BrowserScreenshot;
}>;

export type BrowserShowArgs = Readonly<{ workstreamId: string; bounds: BrowserBounds }>;

export type BrowserNavigateArgs = Readonly<{ workstreamId: string; url: string }>;
