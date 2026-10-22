<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import type { TurnVariant } from '$lib/chat/domain/turn-report';
	import type { FileMentionTarget } from './file-mention-links';
	import MarkdownText from './MarkdownText.svelte';

	interface Props {
		chosen: TurnVariant;
		needs: readonly string[];
		onpick?: ((variant: TurnVariant, reason: string) => void) | undefined;
		onnonefit?: ((reason: string) => void) | undefined;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
	}

	let { chosen, needs, onpick, onnonefit, onopenfile, canopenfile }: Props = $props();

	const headingId = $props.id();
	let reason = $state('');
	let sent = $state(false);

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (!onpick) return;
		sent = true;
		onpick(chosen, reason);
	}

	function noneFit(): void {
		if (!onnonefit) return;
		sent = true;
		onnonefit(reason);
	}
</script>

{#if !sent}
	<section class="bg-brand/10 rounded-md px-2.5 py-2" aria-labelledby={headingId}>
		<h3 id={headingId} class="text-brand-foreground text-xs font-medium">Your turn</h3>
		{#each needs as need, index (index)}
			<MarkdownText
				text={need}
				mode="prose"
				class="text-fg-default mt-1 min-w-0 text-sm leading-relaxed"
				{onopenfile}
				{canopenfile}
			/>
		{/each}
		<form class="mt-2 flex items-center gap-1.5" onsubmit={submit}>
			<TextInput
				bind:value={reason}
				size="xs"
				class="min-w-0 flex-1"
				inputClass="text-xs"
				placeholder={`Why ${chosen.id}? Optional, it steers the next round`}
				ariaLabel="Why this variant"
			/>
			{#if onnonefit}
				<Button variant="ghost" size="sm" class="text-fg-secondary" onclick={noneFit}>
					None fit
				</Button>
			{/if}
			<Button type="submit" variant="primary" size="sm" disabled={!onpick}>
				Go with {chosen.id}
				{#snippet trailing()}
					<Icon name="enter" size={12} />
				{/snippet}
			</Button>
		</form>
	</section>
{/if}
