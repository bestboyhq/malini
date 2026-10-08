<script lang="ts">
	import { formatCount } from '@malini/extension-api';
	import type {
		AgentSessionChangedFile,
		AgentSessionChanges,
	} from '$shared/repositories/repositories.api';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { avoidedByToasts } from '$hyper-ui/components/toast';

	interface Props {
		changes: AgentSessionChanges;
		openingPath?: string | null;
		onopen: (file: AgentSessionChangedFile) => void | Promise<void>;
	}

	const ROW_HEIGHT_PX = 28;
	const VISIBLE_ROWS = 6;
	const OVERSCAN_ROWS = 8;
	const WINDOW_ROWS = VISIBLE_ROWS + 2 * OVERSCAN_ROWS;

	let { changes, openingPath = null, onopen }: Props = $props();
	let expanded = $state(false);
	let observedSessionId = $state<string | null>(null);

	let listHeight = $state(0);
	let drawerHeight = $state(0);
	let scrollTop = $state(0);

	const fileCount = $derived(changes.files.length);
	const additions = $derived(changes.files.reduce((total, file) => total + file.additions, 0));
	const deletions = $derived(changes.files.reduce((total, file) => total + file.deletions, 0));
	const firstRow = $derived(
		Math.max(
			0,
			Math.min(Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS, fileCount - WINDOW_ROWS),
		),
	);
	const rows = $derived(
		expanded || drawerHeight > 0 ? changes.files.slice(firstRow, firstRow + WINDOW_ROWS) : [],
	);

	$effect(() => {
		if (observedSessionId === changes.sessionId) return;
		observedSessionId = changes.sessionId;
		expanded = false;
	});
</script>

<section
	class="chat-column relative z-20 shrink-0 px-6"
	{@attach avoidedByToasts}
	aria-label={`Files changed in this chat (${formatCount(fileCount)})`}
	data-testid="chat-changed-files"
	data-expanded={expanded ? 'true' : 'false'}
	data-session-id={changes.sessionId}
>
	{#if fileCount > 0}
		<div
			class={[
				'chat-changed-files-drawer bg-surface-100 box-content overflow-hidden rounded-t-lg',
				expanded
					? 'border-surface-100-border border border-b-0 opacity-100'
					: 'pointer-events-none opacity-0',
			]}
			style={`height: ${expanded ? listHeight : 0}px;`}
			aria-hidden={!expanded}
			data-testid="chat-changed-files-drawer"
			bind:clientHeight={drawerHeight}
		>
			<div bind:clientHeight={listHeight}>
				<ScrollableDiv
					class="max-h-40"
					viewportClass="max-h-40"
					testId="chat-changed-files-scroll"
					onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
				>
					<ul
						id="chat-changed-file-list"
						aria-label="Files changed in this chat"
						data-testid="chat-changed-files-list"
						style={`height: ${fileCount * ROW_HEIGHT_PX}px; padding-top: ${firstRow * ROW_HEIGHT_PX}px;`}
					>
						{#each rows as file, offset (file.path)}
							<li aria-setsize={fileCount} aria-posinset={firstRow + offset + 1}>
								<Button
									bare
									class="text-fg-secondary hover:bg-surface-100-hover hover:text-fg-default focus-visible:bg-surface-100-hover focus-visible:ring-border-default/50 flex h-7 w-full cursor-pointer items-center gap-2 px-3 text-left text-xs transition-[color,border-color] outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-wait disabled:opacity-60"
									disabled={openingPath !== null}
									tabindex={expanded ? 0 : -1}
									ariaLabel={`Open ${file.path} agent chat diff in Files`}
									ariaBusy={openingPath === file.path}
									data-testid="chat-changed-file"
									data-path={file.path}
									data-run-count={String(file.runIds.length)}
									onclick={() => void onopen(file)}
								>
									<span class="grid h-3 w-3 shrink-0 place-items-center" aria-hidden="true">
										{#if openingPath === file.path}
											<BusyIcon class="text-fg-secondary" size={12} />
										{:else}
											<FileTypeIcon path={file.path} size={12} />
										{/if}
									</span>
									<span class="min-w-0 flex-1 truncate font-mono">{file.path}</span>
									{#if file.additions === 0 && file.deletions === 0}
										<span class="text-2xs text-fg-tertiary shrink-0">
											{file.isBinary ? 'Binary' : 'No line changes'}
										</span>
									{:else}
										<span class="text-2xs shrink-0 font-mono tabular-nums">
											{#if file.additions > 0}<span class="text-success-content">
													+{formatCount(file.additions)}
												</span>{/if}
											{#if file.deletions > 0}<span class="text-error-content ml-1.5">
													−{formatCount(file.deletions)}
												</span>{/if}
										</span>
									{/if}
								</Button>
							</li>
						{/each}
					</ul>
				</ScrollableDiv>
			</div>
		</div>
	{/if}

	<div
		class={[
			'border-surface-100-border bg-surface-100 overflow-hidden border border-b-0',
			expanded ? 'rounded-t-none' : 'rounded-t-lg',
		]}
	>
		{#if fileCount > 0}
			<Button
				variant="ghost"
				size="md"
				class="h-8 w-full justify-start gap-2 px-3 text-left"
				ariaExpanded={expanded}
				ariaControls="chat-changed-file-list"
				data-testid="chat-changed-files-toggle"
				onclick={() => (expanded = !expanded)}
			>
				<Icon
					name="chevron-right"
					class={`h-3 w-3 shrink-0 transition-transform duration-200 ${
						expanded ? 'rotate-90' : '-rotate-90'
					}`}
				/>
				<span class="min-w-0 flex-1 truncate">
					{formatCount(fileCount)}
					{fileCount === 1 ? 'file' : 'files'} changed in this chat
				</span>
				<span class="shrink-0 font-mono text-xs tabular-nums">
					{#if additions > 0}<span class="text-success-content">
							+{formatCount(additions)}
						</span>{/if}
					{#if deletions > 0}<span class="text-error-content ml-1.5">
							−{formatCount(deletions)}
						</span>{/if}
				</span>
			</Button>
		{/if}
	</div>
</section>

<style>
	.chat-changed-files-drawer {
		transition:
			height 240ms cubic-bezier(0.16, 1, 0.3, 1),
			opacity 160ms ease-out;
	}

	@media (prefers-reduced-motion: reduce) {
		.chat-changed-files-drawer {
			transition: none;
		}
	}
</style>
