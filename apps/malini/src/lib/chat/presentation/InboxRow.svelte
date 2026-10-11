<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { RepositoryAvatar } from '$shared/repositories/repositories.api';
	import { dismissInboxEntryCommand } from '$lib/chat/application/commands/dismiss-inbox-entry.command';
	import { openInboxEntryCommand } from '$lib/chat/application/commands/open-inbox-entry.command';
	import { previewWorkstreamImageCommand } from '$lib/chat/application/commands/preview-workstream-image.command';
	import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
	import { replyFromInboxCommand } from '$lib/chat/application/commands/reply-from-inbox.command';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
	import type { InboxEntry } from '$lib/chat/domain/inbox';
	import ImageGallery from './ImageGallery.svelte';
	import { inboxLine, inboxStatus, timeAgo } from './inbox-labels';
	import type { GalleryImage } from './transcript-gallery';
	import { galleryImageLabel, workstreamImagePath } from './workstream-images';

	interface Props {
		entry: InboxEntry;
		now: number;
	}

	let { entry, now }: Props = $props();

	const owner = newChatRequestId();
	let reply = $state('');
	let replyRequestId: ChatRequestId | null = $state(null);
	let galleryOpen = $state(false);

	const screenshots = $derived(
		(entry.attention.images ?? []).flatMap((image): GalleryImage[] => {
			const path = workstreamImagePath(image.src);
			return path === null ? [] : [{ id: path, name: image.alt || path, kind: 'workstream' }];
		}),
	);
	const screenshot = $derived(screenshots[0] ?? null);
	const thumbnail = $derived(imagePreviewQuery.data(owner, screenshot?.id ?? ''));
	const replyOutcome = $derived(chatRequestQuery.data(replyRequestId));
	const sending = $derived(replyOutcome?.status === 'pending');
	const replyError = $derived(replyOutcome?.status === 'failed' ? replyOutcome.error : null);
	const status = $derived(inboxStatus(entry.attention.kind));
	const meta = $derived(
		[entry.repositoryFullName, status, timeAgo(entry.attention.updatedAt, now)]
			.filter(Boolean)
			.join(' · '),
	);
	const needs = $derived(entry.attention.needs ?? []);
	const canReply = $derived(entry.attention.kind !== 'approval');

	onMount(() => {
		if (screenshot) {
			previewWorkstreamImageCommand({
				owner,
				workstreamId: entry.workstreamId,
				path: screenshot.id,
			});
		}
		return () => releaseImagePreviewsCommand(owner);
	});

	function onReply(event: SubmitEvent): void {
		event.preventDefault();
		const prompt = reply.trim();
		if (!prompt || sending) return;
		replyRequestId = newChatRequestId();
		replyFromInboxCommand({ requestId: replyRequestId, workstreamId: entry.workstreamId, prompt });
	}
</script>

<li
	class="flex items-start gap-3 px-4 py-3"
	aria-label={entry.label}
	data-testid="inbox-entry"
	data-workstream-id={entry.workstreamId}
	data-attention-kind={entry.attention.kind}
>
	<span class="mt-0.5 shrink-0" aria-hidden="true">
		<RepositoryAvatar fullName={entry.repositoryFullName} size={28} />
	</span>

	<div class="min-w-0 flex-1">
		<p class="text-fg-default truncate text-sm font-medium">
			<SensitiveText text={entry.label} />
		</p>
		<p class="text-fg-tertiary truncate text-xs">{meta}</p>
		<p
			class={[
				'mt-1.5 line-clamp-2 text-sm leading-5 select-text',
				entry.attention.kind === 'failed' ? 'text-error-content' : 'text-fg-secondary',
			]}
			data-testid="inbox-entry-line"
		>
			{inboxLine(entry.attention)}
		</p>
		{#if needs.length > 0}
			<ul
				class="text-warning-content mt-1 flex flex-col gap-0.5 text-xs leading-5 select-text"
				aria-label="Needs you"
			>
				{#each needs as need, index (index)}
					<li class="flex items-start gap-1.5">
						<Icon name="arrow-right" size={12} class="mt-1 shrink-0" />
						<span class="min-w-0">{need}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if canReply}
			<form class="mt-2.5 flex items-center gap-1" onsubmit={onReply}>
				<TextInput
					bind:value={reply}
					size="xs"
					class="min-w-0 flex-1"
					inputClass="text-xs"
					placeholder="Reply…"
					autocomplete="off"
					ariaLabel={`Reply to ${entry.label}`}
					disabled={sending}
				/>
				<Tooltip content="Send reply" placement="top">
					<IconButton
						type="submit"
						variant="ghost"
						size="sm"
						ariaLabel={`Send reply to ${entry.label}`}
						ariaBusy={sending}
						disabled={sending || reply.trim().length === 0}
					>
						<Icon name="arrow-up" size={14} />
					</IconButton>
				</Tooltip>
			</form>
			{#if replyError}
				<p class="text-2xs text-error-content mt-1" role="alert">{replyError}</p>
			{/if}
		{/if}
	</div>

	{#if screenshot && thumbnail?.status === 'ready'}
		<Button
			bare
			class="border-surface-50-border focus-visible:ring-button-primary/40 mt-0.5 h-12 w-20 shrink-0 cursor-zoom-in overflow-hidden rounded-md border-[0.5px] focus-visible:ring-2 focus-visible:outline-none"
			ariaLabel={galleryImageLabel(screenshot.name)}
			onclick={() => (galleryOpen = true)}
		>
			<img src={thumbnail.src} alt="" class="h-full w-full object-cover" />
		</Button>
	{/if}

	<div class="flex shrink-0 items-center gap-0.5">
		<Button
			variant="secondary"
			size="sm"
			ariaLabel={`Open ${entry.label}`}
			onclick={() => openInboxEntryCommand(entry.workstreamId)}
		>
			Open
		</Button>
		<Tooltip content="Dismiss" placement="top">
			<IconButton
				variant="ghost"
				size="sm"
				ariaLabel={`Dismiss ${entry.label}`}
				onclick={() => dismissInboxEntryCommand(entry.workstreamId)}
			>
				<Icon name="close" size={14} />
			</IconButton>
		</Tooltip>
	</div>

	{#if galleryOpen && screenshot}
		<ImageGallery
			workstreamId={entry.workstreamId}
			images={screenshots}
			startId={screenshot.id}
			onclose={() => (galleryOpen = false)}
		/>
	{/if}
</li>
