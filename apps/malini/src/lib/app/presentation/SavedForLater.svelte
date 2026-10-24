<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import {
		archiveSavedWorkstreamCommand,
		archivedWorkstreamsQuery,
		displayWorkstreamName,
		restoreWorkstreamCommand,
		workstreamBusyActionQuery,
	} from '$shared/repositories/repositories.api';
	import { formatTimeAgo } from '$lib/stats/stats.api';

	interface Props {
		repositoryId: string;
	}

	let { repositoryId }: Props = $props();

	const TITLE_ID = 'saved-for-later-title';
	const CLOCK_MS = 30_000;

	const saved = $derived(
		archivedWorkstreamsQuery.data.filter(
			(workstream) => workstream.savedForLater && workstream.repositoryId === repositoryId,
		),
	);
	const busyActionFor = $derived(workstreamBusyActionQuery.data);
	let nowMs = $state(Date.now());

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		return () => clearInterval(clock);
	});

	function ago(iso: string): string {
		const at = Date.parse(iso);
		return Number.isNaN(at) ? '' : formatTimeAgo(Math.max(0, nowMs - at));
	}
</script>

{#if saved.length > 0}
	<section class="mb-8" aria-labelledby={TITLE_ID} data-testid="saved-for-later">
		<h2 id={TITLE_ID} class="text-fg-tertiary mb-1.5 flex items-center gap-1.5 text-xs font-medium">
			<Icon name="clock" size={12} />
			Saved for later
		</h2>
		<ul class="-mx-2 flex flex-col" aria-labelledby={TITLE_ID}>
			{#each saved as workstream (workstream.id)}
				{@const name = displayWorkstreamName(workstream, workstream.repositoryFullName)}
				{@const busy = busyActionFor(workstream.id)}
				<li
					class="group/saved hover:bg-surface-50-hover focus-within:bg-surface-50-hover flex items-center rounded-lg"
					data-testid="saved-workstream"
					data-workstream-id={workstream.id}
				>
					<Button
						bare
						class="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 text-left outline-none disabled:cursor-default"
						ariaLabel={`Resume ${name}`}
						ariaBusy={busy === 'restore'}
						disabled={busy !== null}
						onclick={() => restoreWorkstreamCommand(workstream.id)}
					>
						<Icon name="branch" size={14} class="text-fg-tertiary shrink-0" />
						<span
							class="text-fg-secondary group-focus-within/saved:text-fg-default group-hover/saved:text-fg-default min-w-0 flex-1 truncate text-sm"
						>
							<SensitiveText text={name} />
						</span>
						{#if busy !== null}
							<span
								class="text-fg-tertiary flex shrink-0 items-center gap-1 text-xs"
								aria-hidden="true"
							>
								<BusyIcon size={11} />
								{busy === 'restore' ? 'Resuming' : 'Archiving'}
							</span>
						{:else}
							<span
								class="text-fg-quaternary shrink-0 text-xs tabular-nums group-focus-within/saved:hidden group-hover/saved:hidden"
								aria-hidden="true"
							>
								{ago(workstream.archivedAt)}
							</span>
							<span
								class="text-fg-tertiary hidden shrink-0 items-center gap-1 text-xs group-focus-within/saved:flex group-hover/saved:flex"
								aria-hidden="true"
							>
								<Icon name="play" size={11} />
								Resume
							</span>
						{/if}
					</Button>
					<span class="hidden shrink-0 pr-1 group-focus-within/saved:flex group-hover/saved:flex">
						<Tooltip content="Archive workstream" placement="top">
							<IconButton
								variant="ghost"
								size="sm"
								ariaLabel={`Archive ${name}`}
								disabled={busy !== null}
								onclick={() => archiveSavedWorkstreamCommand(workstream.id)}
							>
								<Icon name="archive" size={14} />
							</IconButton>
						</Tooltip>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
