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
	const words = $derived(
		[
			...new Intl.Segmenter('en', { granularity: 'word' }).segment(
				details.map((note) => note.text).join('\n'),
			),
		].filter((segment) => segment.isWordLike).length,
	);
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
			<details class="group/details mt-2">
				<summary
					class="bg-surface-100 hover:bg-surface-100-hover border-surface-100-border text-fg-default flex cursor-pointer list-none items-center gap-2 rounded-md border-[0.5px] px-2 py-1 text-xs leading-5"
				>
					<span class="text-fg-tertiary grid shrink-0 place-items-center">
						<Icon name="list-indent" size={14} />
					</span>
					Details
					<span class="text-fg-tertiary">{words} {words === 1 ? 'word' : 'words'}</span>
					<span
						class="text-fg-tertiary ml-auto grid place-items-center transition-transform group-open/details:rotate-90"
					>
						<Icon name="chevron-right" size={12} />
					</span>
				</summary>
				<div class="text-fg-secondary flex flex-col gap-1.5 px-2 pt-2 text-xs leading-5">
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
