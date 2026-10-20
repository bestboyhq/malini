<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { beginPromptEditCommand } from '$lib/chat/application/commands/begin-prompt-edit.command';
	import { endPromptEditCommand } from '$lib/chat/application/commands/end-prompt-edit.command';
	import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
	import type { AgentDraft } from '$lib/chat/domain/draft';
	import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
	import InlinePromptContent from './InlinePromptContent.svelte';
	import PromptEditField from './PromptEditField.svelte';
	import { Icon } from '$hyper-ui/icons';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { EnterShortcut } from '$hyper-ui/components/enter-shortcut';
	import { Tooltip } from '$hyper-ui/components/tooltip';

	interface Props {
		workstreamId: string;
		items: readonly QueuedPrompt[];
		isRunning: boolean;
		paused: boolean;
		sendingId: string | null;
		errorById: Readonly<Record<string, string>>;
		onupdate: (id: string, edit: AgentDraft) => void;
		onremove: (id: string) => void;
		onsendnext: (id: string) => void | Promise<void>;
		onpausechange: (workstreamId: string, paused: boolean) => void;
	}

	let {
		workstreamId,
		items,
		isRunning,
		paused,
		sendingId,
		errorById,
		onupdate,
		onremove,
		onsendnext,
		onpausechange,
	}: Props = $props();

	let editingId = $state<string | null>(null);
	let editingWorkstreamId = $state<string | null>(null);
	let editField: PromptEditField | null = $state(null);
	const editScope = $derived(editingId ? queuedEditScope(editingId) : '');
	const editDraft = $derived(composerDraftQuery.data(editScope));

	function queuedEditScope(id: string): string {
		return `edit|queued:${id}`;
	}

	async function beginEdit(item: QueuedPrompt): Promise<void> {
		beginPromptEditCommand(queuedEditScope(item.id), {
			text: item.prompt,
			contextFiles: item.contextFiles,
			attachments: item.attachments,
			transcriptReferences: item.transcriptReferences,
			elementReferences: item.elementReferences,
		});
		editingId = item.id;
		editingWorkstreamId = workstreamId;
		onpausechange(workstreamId, true);
		await tick();
		editField?.focus();
	}

	function finishEdit(save: boolean): void {
		const id = editingId;
		const owner = editingWorkstreamId;
		if (!id || !owner) return;
		const edit = editDraft;
		const saved = save && edit.text.trim() !== '';
		if (saved) onupdate(id, { ...edit, text: edit.text.trim() });
		endPromptEditCommand({
			workstreamId: owner,
			scope: queuedEditScope(id),
			keep: saved ? edit.attachments : (items.find((item) => item.id === id)?.attachments ?? []),
		});
		editingId = null;
		editingWorkstreamId = null;
		onpausechange(owner, false);
	}

	function onEditKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			finishEdit(false);
		}
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			finishEdit(true);
		}
	}

	$effect(() => {
		if (editingId && !items.some((item) => item.id === editingId)) {
			finishEdit(false);
		}
	});

	onDestroy(() => finishEdit(false));
</script>

<section
	{@attach avoidedByToasts}
	aria-label={`Queued prompts (${items.length})`}
	data-testid="prompt-queue"
	data-workstream-id={workstreamId}
>
	<header class="text-fg-secondary flex h-8 items-center gap-2 px-3 text-xs">
		<span class="text-fg-tertiary grid w-4 shrink-0 place-items-center" aria-hidden="true">
			<Icon name={paused ? 'pause' : 'clock'} size={12} />
		</span>
		<span class="min-w-0 flex-1 truncate" data-testid="prompt-queue-count">
			{items.length} queued {items.length === 1 ? 'prompt' : 'prompts'}
		</span>
		{#if paused}
			<span class="text-2xs text-fg-tertiary shrink-0">
				{editingId ? 'Paused while editing' : 'Paused after restart'}
			</span>
			{#if !editingId}
				<Tooltip content="Resume queued prompts in order" placement="top">
					<IconButton
						variant="ghost"
						size="sm"
						class="text-fg-tertiary"
						ariaLabel="Resume queued prompts"
						onclick={() => onpausechange(workstreamId, false)}
					>
						<Icon name="play" size={12} />
					</IconButton>
				</Tooltip>
			{/if}
		{:else if items.length > 1}
			<span class="text-2xs text-fg-tertiary shrink-0">Runs in order</span>
		{/if}
	</header>

	<ul class="max-h-48 overflow-y-auto px-1 pb-1">
		{#each items as item, index (item.id)}
			<li
				class="hover:bg-surface-50-hover rounded-lg px-2 py-1"
				data-testid="prompt-queue-item"
				data-queued-prompt-id={item.id}
				data-queued-role={item.role}
				data-queued-model={item.model}
			>
				{#if editingId === item.id}
					<div class="flex items-start gap-2">
						<div
							class="border-surface-input-border bg-surface-input focus-within:border-border-default min-w-0 flex-1 rounded-md border transition-[border-color]"
						>
							<PromptEditField
								bind:this={editField}
								{workstreamId}
								scope={editScope}
								ariaLabel="Edit queued prompt"
								testId="queued-prompt-editor"
								compact
								onkeydown={onEditKeydown}
							/>
						</div>
						<div class="flex shrink-0 items-center pt-0.5">
							<Tooltip content={saveHint} placement="top">
								<IconButton
									variant="ghost"
									size="sm"
									class="text-fg-tertiary"
									disabled={!editDraft.text.trim()}
									ariaLabel="Save queued prompt"
									onclick={() => finishEdit(true)}
								>
									<Icon name="check" size={14} />
								</IconButton>
							</Tooltip>
							<Tooltip content="Cancel queued prompt edit · Esc" placement="top">
								<IconButton
									variant="ghost"
									size="sm"
									class="text-fg-tertiary"
									ariaLabel="Cancel queued prompt edit"
									onclick={() => finishEdit(false)}
								>
									<Icon name="close" size={14} />
								</IconButton>
							</Tooltip>
						</div>
					</div>
				{:else}
					<div class="flex min-w-0 items-center gap-2">
						<span class="text-2xs text-fg-tertiary w-4 shrink-0 text-center tabular-nums">
							{index + 1}
						</span>
						<p class="text-fg-secondary min-w-0 flex-1 truncate text-xs leading-6">
							<InlinePromptContent
								text={item.prompt}
								attachments={item.attachments}
								transcriptReferences={item.transcriptReferences}
								elementReferences={item.elementReferences}
								singleLine
							/>
						</p>
						<div class="flex shrink-0 items-center">
							<Tooltip content={`Edit queued prompt ${index + 1}`} placement="top">
								<IconButton
									variant="ghost"
									size="sm"
									class="text-fg-tertiary"
									ariaLabel={`Edit queued prompt ${index + 1}`}
									onclick={() => void beginEdit(item)}
								>
									<Icon name="pencil" size={14} />
								</IconButton>
							</Tooltip>
							<Tooltip content={`Delete queued prompt ${index + 1}`} placement="top">
								<IconButton
									variant="ghost"
									size="sm"
									class="text-fg-tertiary"
									ariaLabel={`Delete queued prompt ${index + 1}`}
									onclick={() => onremove(item.id)}
								>
									<Icon name="trash" size={14} />
								</IconButton>
							</Tooltip>
							<Tooltip
								content={isRunning ? 'Interrupt current response and send this next' : 'Send now'}
								placement="top"
							>
								<IconButton
									variant="ghost"
									size="sm"
									class="text-fg-tertiary"
									disabled={sendingId !== null}
									ariaBusy={sendingId === item.id}
									ariaLabel={`${isRunning ? 'Interrupt and send' : 'Send'} queued prompt ${index + 1}`}
									onclick={() => void onsendnext(item.id)}
								>
									<Icon
										name="arrow-up"
										size={14}
										class={sendingId === item.id ? 'animate-pulse' : ''}
									/>
								</IconButton>
							</Tooltip>
						</div>
					</div>
					{#if errorById[item.id]}
						<p
							class="text-2xs text-error-content mt-1 flex items-start gap-1.5 pl-6 leading-4"
							role="alert"
							data-testid="queued-prompt-error"
						>
							<Icon name="alert" class="mt-px shrink-0" size={13} />
							<span class="min-w-0">{errorById[item.id]}</span>
						</p>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
</section>

{#snippet saveHint()}
	Save queued prompt · <EnterShortcut mod />
{/snippet}
