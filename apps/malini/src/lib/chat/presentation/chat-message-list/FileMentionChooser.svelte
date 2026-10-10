<script module lang="ts">
	import type { RepositoryFileTarget } from '$lib/chat/domain/repository-file-target';

	export type FileMentionChoice = Readonly<{
		mention: RepositoryFileTarget;
		anchor: HTMLElement;
		targets: readonly RepositoryFileTarget[];
	}>;
</script>

<script lang="ts">
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';

	interface Props {
		open: boolean;
		choice: FileMentionChoice | null;
		onchoose: (target: RepositoryFileTarget) => void;
		onclose: () => void;
	}

	let { open, choice, onchoose, onclose }: Props = $props();

	const headingId = $props.id();

	function directoryOf(path: string): string {
		return path.slice(0, path.lastIndexOf('/') + 1);
	}

	function nameOf(path: string): string {
		return path.slice(path.lastIndexOf('/') + 1);
	}
</script>

<DropdownLayer
	open={open && choice !== null}
	anchor={choice?.anchor ?? null}
	{onclose}
	side="bottom"
	align="start"
	role={null}
	panelClass="border-surface-elevated-border bg-surface-elevated max-w-[28rem] min-w-56 overflow-hidden rounded-xl border-[0.5px] py-1"
	testId="file-mention-chooser"
>
	{#if choice}
		<p id={headingId} class="text-fg-tertiary truncate px-3 pt-1 pb-1.5 text-xs">
			{choice.targets.length} files match
			<span class="text-fg-secondary font-mono">{choice.mention.path}</span>
		</p>
		<div role="menu" aria-labelledby={headingId}>
			{#each choice.targets as target (target.path)}
				<DropdownItem
					role="menuitem"
					focusOnHover={false}
					class="px-3"
					aria-label={target.path}
					onSelect={() => onchoose(target)}
				>
					<span class="grid h-3 w-3 shrink-0 place-items-center" aria-hidden="true">
						<FileTypeIcon path={target.path} size={12} />
					</span>
					<span class="flex min-w-0 flex-1 font-mono">
						<span class="text-fg-tertiary truncate">{directoryOf(target.path)}</span>
						<span class="text-fg-default shrink-0">{nameOf(target.path)}</span>
					</span>
				</DropdownItem>
			{/each}
		</div>
	{/if}
</DropdownLayer>
