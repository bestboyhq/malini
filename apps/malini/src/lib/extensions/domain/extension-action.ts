import type { ExtensionDetail } from '$contract/marketplace';

export type ExtensionWork = 'installing' | 'updating' | 'uninstalling' | 'switching' | 'publishing';

export type ExtensionAction =
	| Readonly<{ status: 'working'; work: ExtensionWork }>
	| Readonly<{ status: 'failed'; error: string }>;

export type MarketplaceLoad =
	| Readonly<{ state: 'loading' }>
	| Readonly<{ state: 'ready'; unreachable: string | null }>
	| Readonly<{ state: 'failed'; error: string }>;

export type ExtensionDetailLoad =
	| Readonly<{ state: 'loading' }>
	| Readonly<{ state: 'ready'; detail: ExtensionDetail }>
	| Readonly<{ state: 'failed'; error: string }>;
