<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { clampSize } from '$hyper-ui/components/resizable-split';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import {
		archivedWorkstreamsQuery,
		displayWorkstreamName,
		restoreWorkstreamCommand,
		RepositoryAvatar,
		workstreamBusyActionQuery,
		type ArchivedWorkstreamListing,
	} from '$shared/repositories/repositories.api';
	import { openExternalUrlCommand } from '$lib/app/application/commands/open-external-url.command';
	import { resizeSidebarArchivedCommand } from '$lib/app/application/commands/resize-sidebar-archived.command';
	import { sidebarArchivedHeightQuery } from '$lib/app/application/queries/sidebar-archived-height.query.svelte';
	import {
		ARCHIVED_HEIGHT,
		ARCHIVED_ROW_PX,
		archivedOverflows,
	} from '$lib/app/domain/sidebar-archived';
	import { formatTimeAgo } from '$lib/stats/stats.api';

	const LIST_ID = 'sidebar-recently-archived';
	const TITLE_ID = 'sidebar-recently-archived-title';
	const CLOCK_MS = 30_000;
	const DAY_AND_TIME = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});

	const archived = $derived(archivedWorkstreamsQuery.data);
	const storedHeight = $derived(sidebarArchivedHeightQuery.data);
	const busyActionFor = $derived(workstreamBusyActionQuery.data);
	let nowMs = $state(Date.now());
	let showAll = $state(false);
	let dragHeight = $state<number | null>(null);
	let renderedHeight = $state(0);

	const height = $derived(dragHeight ?? storedHeight);
	const overflows = $derived(archivedOverflows(archived.length, height));

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		return () => clearInterval(clock);
	});

	function clampHeight(next: number): number {
		return clampSize(next, ARCHIVED_HEIGHT.min, ARCHIVED_HEIGHT.max);
	}

	function onResizeStart(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		const { pointerId, clientY: startY } = event;
		const startHeight = renderedHeight;
		showAll = false;
		dragHeight = clampHeight(startHeight);
		const track = (move: PointerEvent): void => {
			if (move.pointerId !== pointerId) return;
			dragHeight = clampHeight(startHeight + startY - move.clientY);
		};
		const release = (end: PointerEvent): void => {
			if (end.pointerId !== pointerId) return;
			window.removeEventListener('pointermove', track);
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
			if (dragHeight !== null) resizeSidebarArchivedCommand(dragHeight);
			dragHeight = null;
		};
		window.addEventListener('pointermove', track);
		window.addEventListener('pointerup', release);
		window.addEventListener('pointercancel', release);
	}

	function onResizeKey(event: KeyboardEvent): void {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		showAll = false;
		const step = event.key === 'ArrowUp' ? ARCHIVED_ROW_PX : -ARCHIVED_ROW_PX;
		resizeSidebarArchivedCommand(storedHeight + step);
	}

	function ago(iso: string): string {
		const at = Date.parse(iso);
		return Number.isNaN(at) ? '' : formatTimeAgo(Math.max(0, nowMs - at));
	}

	function detail(workstream: ArchivedWorkstreamListing): string {
		const at = new Date(workstream.archivedAt);
		const merged = workstream.mergedPullRequest;
		return [
			merged ? `Merged #${merged.number}` : null,
			workstream.repositoryFullName,
			Number.isNaN(at.getTime()) ? null : `archived ${DAY_AND_TIME.format(at)}`,
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

{#if archived.length > 0}
	<section
		class="border-surface-50-border relative flex shrink-0 flex-col border-t pb-2"
		aria-labelledby={TITLE_ID}
		data-testid="sidebar-archived"
	>
		<div
			class="focus-visible:bg-surface-50-selected absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize outline-none"
			role="slider"
			tabindex="0"
			aria-orientation="vertical"
			aria-label="Recently archived height"
			aria-controls={LIST_ID}
			aria-valuemin={ARCHIVED_HEIGHT.min}
			aria-valuemax={ARCHIVED_HEIGHT.max}
			aria-valuenow={Math.round(height)}
			data-testid="sidebar-archived-resize"
			onpointerdown={onResizeStart}
			onkeydown={onResizeKey}
		></div>
		<div class="flex h-7 items-center gap-2 px-4">
			<h2 id={TITLE_ID} class="text-fg-tertiary min-w-0 flex-1 truncate text-xs font-medium">
				Recently archived
			</h2>
			{#if overflows || showAll}
				<Button
					bare
					class="text-2xs text-fg-quaternary hover:text-fg-secondary focus-visible:ring-border-default/50 shrink-0 cursor-pointer rounded outline-none focus-visible:ring-2"
					ariaExpanded={showAll}
					ariaControls={LIST_ID}
					data-testid="sidebar-archived-show-all"
					onclick={() => (showAll = !showAll)}
				>
					{showAll ? 'Show less' : 'Show all'}
				</Button>
			{/if}
		</div>

		<div
			class={[showAll && 'max-h-[50vh]']}
			style:--scrollable-fade-color="var(--color-surface-50)"
			style:max-height={showAll ? undefined : `${height}px`}
			bind:clientHeight={renderedHeight}
		>
			<ScrollableDiv class="max-h-[inherit]" fadeEdges>
				<ul id={LIST_ID} class="flex flex-col px-2" aria-labelledby={TITLE_ID}>
					{#each archived as workstream (workstream.id)}
						{@const name = displayWorkstreamName(workstream, workstream.repositoryFullName)}
						{@const restoring = busyActionFor(workstream.id) === 'restore'}
						{@const merged = workstream.mergedPullRequest}
						<li
							class="group/archived hover:bg-surface-50-hover flex items-center rounded-lg"
							data-testid="sidebar-archived-workstream"
							data-workstream-id={workstream.id}
						>
							<Tooltip content={detail(workstream)} placement="right" class="min-w-0 flex-1">
								<Button
									bare
									class="flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 pr-2 pl-2 text-left outline-none disabled:cursor-default"
									ariaLabel={`Restore ${name}`}
									ariaBusy={restoring}
									disabled={restoring}
									data-testid="sidebar-restore-workstream"
									onclick={() => restoreWorkstreamCommand(workstream.id)}
								>
									{#if workstream.repositoryFullName}
										<RepositoryAvatar fullName={workstream.repositoryFullName} size={16} />
									{:else}
										<span class="text-fg-quaternary grid size-4 shrink-0 place-items-center">
											<Icon name="archive" size={13} />
										</span>
									{/if}
									<span
										class="text-fg-tertiary group-focus-within/archived:text-fg-secondary group-hover/archived:text-fg-secondary min-w-0 flex-1 truncate text-xs"
									>
										<SensitiveText text={name} />
									</span>
									{#if restoring}
										<span
											class="text-2xs text-fg-tertiary flex shrink-0 items-center gap-1"
											aria-hidden="true"
										>
											<BusyIcon size={11} />
											Restoring
										</span>
									{:else}
										<span
											class="text-2xs text-fg-quaternary shrink-0 tabular-nums group-focus-within/archived:hidden group-hover/archived:hidden"
											aria-hidden="true"
										>
											{ago(workstream.archivedAt)}
										</span>
										<span
											class="text-2xs text-fg-tertiary hidden shrink-0 items-center gap-1 group-focus-within/archived:flex group-hover/archived:flex"
											aria-hidden="true"
										>
											<Icon name="undo" size={11} />
											Restore
										</span>
									{/if}
								</Button>
							</Tooltip>
							{#if merged?.url}
								{@const url = merged.url}
								<span
									class="hidden shrink-0 pr-1 group-focus-within/archived:flex group-hover/archived:flex"
								>
									<Tooltip content={`Open #${merged.number} on GitHub`} placement="top">
										<IconButton
											variant="ghost"
											size="2xs"
											ariaLabel={`Open pull request #${merged.number} on GitHub`}
											class="text-fg-tertiary"
											data-testid="sidebar-archived-pull-request"
											onclick={() => openExternalUrlCommand(url)}
										>
											<Icon name="external-link" size={11} />
										</IconButton>
									</Tooltip>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			</ScrollableDiv>
		</div>
	</section>
{/if}
