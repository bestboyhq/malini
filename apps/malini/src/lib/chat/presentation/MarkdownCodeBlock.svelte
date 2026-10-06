<script lang="ts">
	import { copyTextCommand } from '$lib/chat/application/commands/copy-text.command';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
	import { Icon } from '$hyper-ui/icons';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import CodeTokens from './CodeTokens.svelte';
	import {
		detectLanguage,
		languageHintLabel,
		languageLabel,
		normalizeLanguage,
	} from '@malini/extension-api';

	interface Props {
		code: string;
		safeHtml: string;
		language?: string | null;
	}

	let { code, language = null }: Props = $props();
	let copyRequestId = $state<ChatRequestId | null>(null);
	const copyOutcome = $derived(chatRequestQuery.data(copyRequestId));
	const copied = $derived(copyOutcome?.status === 'accepted');

	const resolvedLanguage = $derived(normalizeLanguage(language) ?? detectLanguage(code));
	const label = $derived(languageHintLabel(language) ?? languageLabel(resolvedLanguage));

	$effect(() => {
		if (!copied) return;
		const reset = setTimeout(() => {
			copyRequestId = null;
		}, 1_500);
		return () => clearTimeout(reset);
	});

	function copyCode(): void {
		const requestId = newChatRequestId();
		copyRequestId = requestId;
		copyTextCommand({ requestId, text: code });
	}
</script>

<div
	class="border-surface-50-border relative my-[0.5em] max-w-full overflow-hidden rounded-xl border-[0.5px]"
	data-testid="markdown-code-block"
	data-language={resolvedLanguage ?? undefined}
>
	{#if label}
		<div class="flex h-9 items-center px-3 pt-2">
			<span class="text-3xs text-fg-tertiary leading-none" data-testid="markdown-code-language">
				{label}
			</span>
		</div>
	{/if}

	<Tooltip
		content={copied ? 'Copied' : 'Copy code'}
		placement="top"
		class="absolute top-2 right-2 z-30"
	>
		<IconButton
			variant="secondary"
			size="md"
			bordered
			class="border-surface-elevated-border bg-surface-elevated text-fg-tertiary hover:bg-surface-elevated-hover rounded-md"
			ariaLabel={copied ? 'Code copied' : 'Copy code'}
			data-testid="markdown-code-copy"
			onclick={copyCode}
		>
			{#if copied}
				<Icon name="check" size={14} class="text-fg-default" />
			{:else}
				<Icon name="copy" size={14} />
			{/if}
		</IconButton>
	</Tooltip>

	<ScrollableDiv
		orientation="x"
		class={label ? 'w-full' : 'mr-11'}
		viewportClass="max-w-full"
		ariaLabel="Code block"
		testId="markdown-code-scroll"
	>
		<pre
			data-managed-code-block
			class={['m-0 min-w-max bg-transparent px-3 pb-3', label ? 'pt-0' : 'pt-3']}><CodeTokens
				{code}
				language={resolvedLanguage}
			/></pre>
	</ScrollableDiv>
</div>
