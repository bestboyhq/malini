<script lang="ts">
	import type { LeadDecision } from '$contract/leads';
	import { answerLeadDecisionCommand } from '$lib/chat/application/commands/answer-lead-decision.command';
	import MediaViewer, { type ViewerItem } from './MediaViewer.svelte';

	interface Props {
		decision: LeadDecision;
		option: number;
		onclose: () => void;
	}

	let { decision, option, onclose }: Props = $props();

	const shown = $derived(
		decision.options.flatMap((candidate, index) =>
			candidate.picture ? [{ index, picture: candidate.picture, label: candidate.label }] : [],
		),
	);
	const items = $derived<ViewerItem[]>(
		shown.map(({ picture, label }) => ({
			workstreamId: picture.workstreamId,
			src: picture.path,
			label,
		})),
	);
	const at = (index: number | null): number | null => {
		if (index === null) return null;
		const found = shown.findIndex((entry) => entry.index === index);
		return found === -1 ? null : found;
	};
	const start = $derived(at(option) ?? 0);
	const picked = $derived(at(decision.answer?.option ?? null));
	const recommended = $derived(at(decision.recommended));
</script>

{#if items.length > 0}
	<MediaViewer
		{items}
		{start}
		title={decision.topic}
		pick={{
			picked,
			recommended,
			onpick: (index, reason) => {
				const chosen = shown[index];
				if (chosen) answerLeadDecisionCommand(decision.id, chosen.index, reason);
			},
		}}
		{onclose}
	/>
{/if}
