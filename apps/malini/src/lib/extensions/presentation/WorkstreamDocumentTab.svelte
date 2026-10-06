<script lang="ts">
	import { tick } from 'svelte';
	import { BrowserTab } from '$hyper-ui/components/browser-tab';
	import type { WorkstreamDocument } from '$shared/shell/workstream-tabs';
	import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';
	import ExtensionPanelIcon from './ExtensionPanelIcon.svelte';
	import { workstreamDocumentPanelId } from './WorkstreamDocument.svelte';

	interface Props {
		workstreamId: string;
		document: WorkstreamDocument;
		tabId: string;
		tabindex: number;
	}

	let { workstreamId, document: file, tabId, tabindex }: Props = $props();

	const selected = $derived(workstreamTabs.for(workstreamId).activeDocumentId === file.id);

	function closeDocument(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		workstreamTabs.close(workstreamId, file.id);
		void focusDocumentTab(workstreamTabs.for(workstreamId).activeDocumentId);
	}

	async function focusDocumentTab(documentId: string | null): Promise<void> {
		if (!documentId) return;
		await tick();
		document
			.querySelector<HTMLElement>(
				`[data-testid="workstream-document-tab"][data-document-id="${CSS.escape(documentId)}"]`,
			)
			?.focus({ preventScroll: true });
	}
</script>

<BrowserTab
	surface="band"
	label={file.label}
	{selected}
	{tabId}
	{tabindex}
	ariaControls={selected ? workstreamDocumentPanelId(workstreamId) : undefined}
	preview={file.preview}
	description={file.preview ? 'Preview' : undefined}
	tooltip={file.tooltip}
	closeLabel={`Close ${file.label}`}
	tooltipPlacement="top"
	tabAttributes={{
		'data-testid': 'workstream-document-tab',
		'data-document-id': file.id,
	}}
	closeAttributes={{ 'data-testid': 'workstream-document-tab-close' }}
	onselect={() => workstreamTabs.select(workstreamId, file.id)}
	onpin={() => workstreamTabs.pin(workstreamId, file.id)}
	onclose={closeDocument}
>
	{#snippet icon()}
		<span class="grid place-items-center" aria-hidden="true">
			<ExtensionPanelIcon icon={file.icon} size={14} />
		</span>
	{/snippet}
</BrowserTab>
