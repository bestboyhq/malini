<script lang="ts">
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import type { TurnNote } from '$lib/chat/domain/turn-report';
	import type { FileMentionTarget } from './file-mention-links';
	import MarkdownText from './MarkdownText.svelte';

	interface Props {
		notes: readonly TurnNote[];
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let { notes, onopenfile, canopenfile, imagesrc, onopenimage }: Props = $props();

	const KINDS = {
		changed: { icon: 'delta', label: 'Changed', tone: 'text-fg-tertiary' },
		verified: { icon: 'shield-check', label: 'Verified', tone: 'text-success-content' },
	} as const satisfies Record<string, Readonly<{ icon: IconName; label: string; tone: string }>>;

	const rows = $derived(
		notes.filter(
			(note): note is TurnNote & { kind: keyof typeof KINDS } =>
				note.kind === 'changed' || note.kind === 'verified',
		),
	);
	const details = $derived(notes.filter((note) => note.kind === 'note'));
</script>

{#if rows.length > 0 || details.length > 0}
	<div class="flex flex-col gap-0.5" data-testid="turn-report-notes">
		{#each rows as note, index (index)}
			{@const kind = KINDS[note.kind]}
			<details class="group/note">
				<summary
					class="hover:bg-surface-50-hover -mx-1.5 flex cursor-pointer list-none items-start gap-2 rounded-[5px] px-1.5 text-xs leading-5"
				>
					<Tooltip
						content={kind.label}
						placement="left"
						class={['h-5 w-3.5 shrink-0 items-center justify-center', kind.tone]}
					>
						<Icon name={kind.icon} size={14} ariaLabel={kind.label} />
					</Tooltip>
					<MarkdownText
						text={note.text}
						mode="prose"
						class="text-fg-secondary line-clamp-1 min-w-0 flex-1 select-text group-open/note:line-clamp-none"
						{onopenfile}
						{canopenfile}
					/>
				</summary>
			</details>
		{/each}
		{#if details.length > 0}
			<details class="group/details pl-[22px]">
				<summary
					class="text-2xs text-fg-tertiary hover:text-fg-secondary inline-flex cursor-pointer list-none items-center gap-0.5 leading-5 transition-[color]"
				>
					Details
					<span class="transition-transform group-open/details:rotate-90">
						<Icon name="chevron-right" size={10} />
					</span>
				</summary>
				<div class="text-fg-secondary mt-1 flex flex-col gap-1.5 text-xs leading-5">
					{#each details as note, index (index)}
						<MarkdownText
							text={note.text}
							mode="prose"
							class="min-w-0 select-text"
							{onopenfile}
							{canopenfile}
							{imagesrc}
							{onopenimage}
						/>
					{/each}
				</div>
			</details>
		{/if}
	</div>
{/if}
