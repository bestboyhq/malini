<script lang="ts">
	import { onMount } from 'svelte';
	import { languageForPath } from '@malini/extension-api';
	import { Button } from '$hyper-ui/components/button';
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { BusyIcon } from '$hyper-ui/icons';
	import type { FullToolOutput } from '$lib/chat/domain/full-tool-output';
	import FilePreviewHeader from './FilePreviewHeader.svelte';
	import { readOutputLines } from './read-output';

	interface Props {
		path: string;
		output: unknown;
		fullLength?: number | null;
		fullOutput?: FullToolOutput | null;
		onloadfull?: (() => void) | undefined;
	}

	let { path, output, fullLength = null, fullOutput = null, onloadfull }: Props = $props();

	const SHOWN_LINES = 400;
	const CAP_SLACK_LINES = 100;

	let showAll = $state(false);

	const loaded = $derived(fullOutput?.status === 'ready' ? fullOutput.output : null);
	const text = $derived(loaded ?? (typeof output === 'string' ? output : null));
	const lines = $derived(text === null ? [] : readOutputLines(text));
	const capped = $derived(!showAll && lines.length > SHOWN_LINES + CAP_SLACK_LINES);
	const shown = $derived(capped ? lines.slice(0, SHOWN_LINES) : lines);
	const numbered = $derived(lines[0]?.number != null);
	const range = $derived(numbered ? `${lines[0]?.number}–${lines.at(-1)?.number}` : null);
	const truncated = $derived(fullLength !== null && loaded === null);

	onMount(() => {
		if (fullLength !== null) onloadfull?.();
	});
</script>

<section aria-label={`Contents of ${path}`} data-testid="read-file-preview">
	<FilePreviewHeader {path}>
		{#if range}
			<span class="text-3xs text-fg-tertiary shrink-0 font-mono tabular-nums">Lines {range}</span>
		{/if}
	</FilePreviewHeader>

	{#if text === null}
		<div class="text-2xs text-fg-tertiary flex items-center gap-2 px-2.5 py-3" role="status">
			<BusyIcon class="text-fg-tertiary" size={12} />
			Reading the file…
		</div>
	{:else}
		<ScrollableDiv orientation="xy" class="max-h-80" viewportClass="max-h-80 max-w-full">
			<div class="text-2xs flex min-w-max py-2 font-mono leading-snug">
				{#if numbered}
					<pre
						class="text-fg-tertiary/70 m-0 pr-3 pl-2.5 text-right tabular-nums select-none"
						aria-hidden="true">{shown.map((line) => line.number).join('\n')}</pre>
				{/if}
				<pre class={['m-0 pr-6 select-text', !numbered && 'pl-2.5']}><CodeTokens
						code={shown.map((line) => line.text).join('\n')}
						language={languageForPath(path)}
					/></pre>
			</div>
			{#if capped || truncated}
				<div class="px-2.5 pb-1.5">
					{#if capped}
						<Button size="xs" variant="ghost" onclick={() => (showAll = true)}>
							Show all {lines.length} lines
						</Button>
					{:else}
						<Button
							size="xs"
							variant="ghost"
							loading={fullOutput?.status === 'loading'}
							onclick={() => onloadfull?.()}
						>
							Show full output · {Math.max(1, Math.round((fullLength ?? 0) / 1024))} KB
						</Button>
					{/if}
				</div>
			{/if}
		</ScrollableDiv>
	{/if}
</section>
