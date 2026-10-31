export type ExtensionServer = Readonly<{ name: string; url: string }>;

export type ExtensionListing = Readonly<{
	publisher: string;
	name: string;
	displayName: string;
	description: string;
	version: string;
	publishedOn: string;
	repository: string | null;
	mcpServers: readonly ExtensionServer[];
	skills: readonly string[];
}>;

export type ExtensionVersion = Readonly<{ version: string; publishedOn: string; yanked: boolean }>;

export type ExtensionDetail = Readonly<{
	listing: ExtensionListing;
	readme: string | null;
	versions: readonly ExtensionVersion[];
}>;

export type InstalledExtension = Readonly<{
	publisher: string;
	name: string;
	displayName: string;
	description: string;
	version: string;
	repository: string | null;
	mcpServers: readonly ExtensionServer[];
	skills: readonly string[];
	enabled: boolean;
	withdrawn: boolean;
	installedAt: string;
}>;

export type MarketplaceListings = Readonly<{
	listings: readonly ExtensionListing[];
	unreachable: string | null;
}>;

export type ExtensionRefArgs = Readonly<{ publisher: string; name: string }>;

export type SwitchExtensionArgs = Readonly<{ name: string; enabled: boolean }>;

export type UninstallExtensionArgs = Readonly<{ name: string }>;

export type PublishableExtension = Readonly<{
	repositoryId: string;
	repository: string;
	name: string | null;
	displayName: string | null;
	version: string | null;
	liveVersion: string | null;
	problem: string | null;
}>;

export type Publishing = Readonly<{
	signedIn: boolean;
	handle: string | null;
	extensions: readonly PublishableExtension[];
}>;

export type PublishExtensionArgs = Readonly<{ repositoryId: string }>;

export type ClaimHandleArgs = Readonly<{ handle: string }>;

export type ClaimHandleResult = Readonly<{ problem: string | null }>;

export type ExtensionChange =
	'installed' | 'updated' | 'uninstalled' | 'turned-on' | 'turned-off' | 'withdrawn';

export type ExtensionChangedEvent = Readonly<{
	publisher: string;
	name: string;
	version: string;
	change: ExtensionChange;
}>;

export type ExtensionPublishedEvent = Readonly<{
	publisher: string;
	name: string;
	version: string;
	repository: string;
}>;
