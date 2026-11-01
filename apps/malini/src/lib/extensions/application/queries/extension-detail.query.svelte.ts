import type { ExtensionDetailLoad } from '$lib/extensions/domain/extension-action';
import { extensionKey } from '$lib/extensions/domain/extension-entry';
import { extensionDetailsAggregate } from '$lib/extensions/infrastructure/aggregates/extension-details.aggregate.svelte';

export { extensionDetailQuery };

class ExtensionDetailQuery {
	public readonly data: (publisher: string, name: string) => ExtensionDetailLoad | null = $derived(
		(publisher: string, name: string) =>
			extensionDetailsAggregate.details.get(extensionKey(publisher, name)) ?? null,
	);
}

const extensionDetailQuery = new ExtensionDetailQuery();
