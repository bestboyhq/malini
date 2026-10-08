<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
	import { modelLabel } from '$shared/providers/providers.api';
	import { Icon } from '$hyper-ui/icons';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { Tooltip } from '$hyper-ui/components/tooltip';

	interface Props {
		workstreamId: string;
		items: readonly QueuedPrompt[];
		isRunning: boolean;
		paused: boolean;
		sendingId: string | null;
		errorById: Readonly<Record<string, string>>;
		onupdate: (id: string, prompt: string) => void;
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
	let editText = $state('');

	function queuedModelLabel(item: QueuedPrompt): string {
		return modelLabel(item.model);
	}

	function beginEdit(item: QueuedPrompt): void {
		editingId = item.id;
		editingWorkstreamId = workstreamId;
		editText = item.prompt;
		onpausechange(workstreamId, true);
	}

	function finishEdit(save: boolean): void {
		const id = editingId;
		const owner = editingWorkstreamId;
		if (save && id && editText.trim()) onupdate(id, editText.trim());
		editingId = null;
		editingWorkstreamId = null;
		editText = '';
		if (owner) onpausechange(owner, false);
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

	onDestroy(() => {
		if (editingWorkstreamId) onpausechange(editingWorkstreamId, false);
	});
</script>

<div class="chat-column px-8" {@attach avoidedByToasts}>
	<section
		class="border-surface-50-border bg-surface-50 mt-2 overflow-hidden rounded-t-xl border-x-[0.5px] border-t-[0.5px]"
		data-testid="prompt-queue"
		data-workstream-id={workstreamId}
	>
		<header class="border-surface-50-border flex h-8 items-center gap-2 border-b-[0.5px] px-3">
			<span class="text-2xs text-fg-tertiary font-medium tracking-[0.08em] uppercase">Next</span>
			<span
				class="bg-surface-root text-fg-secondary rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
				data-testid="prompt-queue-count"
			>
				{items.length}
			</span>
			{#if paused}
				<span class="text-2xs text-fg-tertiary ml-auto">
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
			{:else}
				<span class="text-2xs text-fg-tertiary ml-auto">Runs in order</span>
			{/if}
		</header>

		<ul class="max-h-48 overflow-y-auto p-1.5">
			{#each items as item, index (item.id)}
				<li
					class="group/queued hover:bg-surface-50-hover rounded-lg px-2 py-1.5"
					data-testid="prompt-queue-item"
					data-queued-prompt-id={item.id}
					data-queued-role={item.role}
					data-queued-model={item.model}
				>
					{#if editingId === item.id}
						<div class="flex items-start gap-2">
							<Textarea
								bind:value={editText}
								rows={2}
								ariaLabel="Edit queued prompt"
								class="min-w-0 flex-1"
								textareaClass="min-h-14 text-xs leading-relaxed"
								onkeydown={onEditKeydown}
							/>
							<div class="flex shrink-0 items-center gap-1 pt-0.5">
								<Tooltip content="Save queued prompt · ⌘↵" placement="top">
									<IconButton
										variant="ghost"
										size="md"
										class="text-fg-tertiary"
										disabled={!editText.trim()}
										ariaLabel="Save queued prompt"
										onclick={() => finishEdit(true)}
									>
										<Icon name="check" size={14} />
									</IconButton>
								</Tooltip>
								<Tooltip content="Cancel queued prompt edit · Esc" placement="top">
									<IconButton
										variant="ghost"
										size="md"
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
							<span class="text-fg-tertiary w-4 shrink-0 text-center text-[10px] tabular-nums">
								{index + 1}
							</span>
							<p class="text-fg-secondary line-clamp-2 min-w-0 flex-1 text-xs leading-5">
								{item.prompt}
							</p>
							<Tooltip
								content={`${item.role === 'planning' ? 'Planning' : 'Implementation'} turn · ${queuedModelLabel(item)}`}
								placement="top"
							>
								<span
									class="border-chip-border bg-chip text-fg-tertiary inline-flex h-6 shrink-0 items-center rounded-md border px-1.5 text-[10px] font-medium"
									data-testid="queued-model-snapshot"
								>
									{item.role === 'planning' ? 'Plan' : 'Build'} · {queuedModelLabel(item)}
								</span>
							</Tooltip>
							{#if item.contextFiles.length > 0}
								<Tooltip
									content={`${item.contextFiles.length} context file${item.contextFiles.length === 1 ? '' : 's'}`}
									placement="top"
								>
									<span
										class="border-chip-border bg-chip text-fg-tertiary inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium tabular-nums"
										data-testid="queued-context-count"
									>
										<Icon name="paperclip" size={12} />
										{item.contextFiles.length}
									</span>
								</Tooltip>
							{/if}
							{#if item.attachments.length > 0}
								<Tooltip
									content={`${item.attachments.length} attachment${item.attachments.length === 1 ? '' : 's'}`}
									placement="top"
								>
									<span
										class="border-chip-border bg-chip text-fg-tertiary inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium tabular-nums"
										data-testid="queued-attachment-count"
									>
										<Icon name="paperclip" size={12} />
										{item.attachments.length}
									</span>
								</Tooltip>
							{/if}
							{#if item.issueReferences.length > 0}
								<Tooltip
									content={`${item.issueReferences.length} issue reference${item.issueReferences.length === 1 ? '' : 's'}`}
									placement="top"
								>
									<span
										class="border-chip-border bg-chip text-fg-tertiary inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium tabular-nums"
										data-testid="queued-issue-reference-count"
									>
										<Icon name="hash" size={12} />
										{item.issueReferences.length}
									</span>
								</Tooltip>
							{/if}
							{#if item.elementReferences.length > 0}
								<Tooltip
									content={`${item.elementReferences.length} page element${item.elementReferences.length === 1 ? '' : 's'}`}
									placement="top"
								>
									<span
										class="border-chip-border bg-chip text-fg-tertiary inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium tabular-nums"
										data-testid="queued-element-reference-count"
									>
										<Icon name="preview" size={12} />
										{item.elementReferences.length}
									</span>
								</Tooltip>
							{/if}
							<div
								class="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover/queued:opacity-100 focus-within:opacity-100"
							>
								<Tooltip content={`Edit queued prompt ${index + 1}`} placement="top">
									<IconButton
										variant="ghost"
										size="md"
										class="text-fg-tertiary"
										ariaLabel={`Edit queued prompt ${index + 1}`}
										onclick={() => beginEdit(item)}
									>
										<Icon name="pencil" size={14} />
									</IconButton>
								</Tooltip>
								<Tooltip
									content={isRunning ? 'Interrupt current response and send this next' : 'Send now'}
									placement="top"
								>
									<IconButton
										variant="ghost"
										size="md"
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
								<Tooltip content={`Delete queued prompt ${index + 1}`} placement="top">
									<IconButton
										variant="ghost"
										size="md"
										class="text-fg-tertiary"
										ariaLabel={`Delete queued prompt ${index + 1}`}
										onclick={() => onremove(item.id)}
									>
										<Icon name="trash" size={14} />
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
</div>
