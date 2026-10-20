<script module lang="ts">
	export function workstreamDocumentPanelId(workstreamId: string): string {
		return `workstream-document-${encodeURIComponent(workstreamId)}`;
	}
</script>

<script lang="ts">
	import { extensionPanelInstanceParts } from '@malini/extension-api';
	import { workstreamDocuments } from '$shared/shell/workstream-tabs';
	import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';
	import { extensionDocumentTemplateQuery } from '../application/queries/extension-document-template.query.svelte';
	import { extensionPanelContextQuery } from '../application/queries/extension-panel-context.query.svelte';
	import { extensionWorkstreamQuery } from '../application/queries/extension-workstream.query.svelte';
	import ExtensionPanelHost from './ExtensionPanelHost.svelte';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const tabs = $derived(workstreamTabs.for(workstreamId));
	const active = $derived(
		workstreamDocuments(tabs).find((candidate) => candidate.id === tabs.activeDocumentId) ?? null,
	);
	const templateId = $derived(active ? extensionPanelInstanceParts(active.id)?.templateId : null);
	const instanceKey = $derived(active ? extensionPanelInstanceParts(active.id)?.instanceKey : null);
	const template = $derived(extensionDocumentTemplateQuery.data(templateId ?? ''));
	const runtimeWorkstream = $derived(extensionWorkstreamQuery.data);
	const workstream = $derived(runtimeWorkstream?.id === workstreamId ? runtimeWorkstream : null);
	const panelContext = $derived(extensionPanelContextQuery.data(workstream));
	const context = $derived({ ...panelContext, instanceKey: instanceKey ?? '' });
	const mountable = $derived(template !== null && workstream !== null && !!instanceKey);
	let failure: { documentId: string; message: string } | null = $state(null);

	function onPanelError(cause: unknown): void {
		if (!active) return;
		failure = {
			documentId: active.id,
			message: cause instanceof Error && cause.message ? cause.message : String(cause),
		};
	}
</script>

{#if active}
	<div
		class="bg-surface-50 border-surface-50-border relative mx-3 mt-1 mb-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-[0.5px]"
		id={workstreamDocumentPanelId(workstreamId)}
		role="tabpanel"
		aria-label={active.label}
		aria-busy={!mountable}
		data-testid="workstream-document"
		data-document-id={active.id}
	>
		{#if mountable && template}
			{#key active.id}
				<ExtensionPanelHost
					panel={template}
					{context}
					{workstreamId}
					onerror={(cause) => onPanelError(cause)}
				/>
			{/key}
		{/if}
		{#if failure?.documentId === active.id}
			<div class="absolute inset-0 grid place-items-center p-6" role="alert">
				<div
					class="border-surface-elevated-border bg-surface-elevated max-w-80 rounded-lg border-[0.5px] p-3"
				>
					<p class="text-fg-secondary text-sm">{active.label} is unavailable</p>
					<p class="text-fg-tertiary mt-1 text-xs">{failure.message}</p>
				</div>
			</div>
		{/if}
	</div>
{/if}
