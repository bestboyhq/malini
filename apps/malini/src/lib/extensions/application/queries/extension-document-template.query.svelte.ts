import type { ExtensionPanelRegistration } from '@malini/extension-api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class ExtensionDocumentTemplateQuery {
	public readonly data: (templateId: string) => ExtensionPanelRegistration | null = $derived(
		(templateId: string) => extensionRuntimeStore.documentTemplate(templateId),
	);
}

export const extensionDocumentTemplateQuery = new ExtensionDocumentTemplateQuery();
