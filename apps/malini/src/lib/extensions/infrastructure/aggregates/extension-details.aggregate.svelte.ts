import type { ExtensionDetailLoad } from '$lib/extensions/domain/extension-action';

class ExtensionDetailsAggregate {
	details = $state.raw<ReadonlyMap<string, ExtensionDetailLoad>>(new Map());

	set(key: string, load: ExtensionDetailLoad): void {
		this.details = new Map(this.details).set(key, load);
	}
}

export const extensionDetailsAggregate = new ExtensionDetailsAggregate();
