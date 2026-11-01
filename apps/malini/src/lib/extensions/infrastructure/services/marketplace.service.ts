import type {
	ExtensionChangedEvent,
	ExtensionDetail,
	ExtensionListing,
	InstalledExtension,
	MarketplaceListings,
	Publishing,
} from '$contract/marketplace';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class MarketplaceService {
	listings(): Promise<MarketplaceListings> {
		return invoke('extensions.list-listings', undefined);
	}

	detail(publisher: string, name: string): Promise<ExtensionDetail> {
		return invoke('extensions.get-listing', { publisher, name });
	}

	installed(): Promise<InstalledExtension[]> {
		return invoke('extensions.list-installed', undefined);
	}

	install(publisher: string, name: string): Promise<InstalledExtension> {
		return invoke('extensions.install', { publisher, name });
	}

	async uninstall(name: string): Promise<void> {
		await invoke('extensions.uninstall', { name });
	}

	switch(name: string, enabled: boolean): Promise<InstalledExtension> {
		return invoke('extensions.switch', { name, enabled });
	}

	publishing(): Promise<Publishing> {
		return invoke('extensions.publishing', undefined);
	}

	publish(repositoryId: string): Promise<ExtensionListing> {
		return invoke('extensions.publish', { repositoryId });
	}

	async claimHandle(handle: string): Promise<string | null> {
		return (await invoke('extensions.claim-handle', { handle })).problem;
	}

	onChanged(listener: (change: ExtensionChangedEvent) => void): () => void {
		return onPlatformEvent('extensions:changed', listener);
	}

	onPublishingChanged(listener: () => void): () => void {
		const stopPublished = onPlatformEvent('extensions:published', () => listener());
		const stopProfile = onPlatformEvent('stats:profile-changed', () => listener());
		return () => {
			stopPublished();
			stopProfile();
		};
	}
}

export const marketplaceService = new MarketplaceService();
