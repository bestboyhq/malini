<script lang="ts">
	import type { UpdateChange, UpdateRelease } from '$contract/events';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { HoverCard } from '$hyper-ui/components/hover-card';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { checkForUpdatesCommand } from '$lib/app/application/commands/check-for-updates.command';
	import { restartToUpdateCommand } from '$lib/app/application/commands/restart-to-update.command';
	import { restartingToUpdateQuery } from '$lib/app/application/queries/restarting-to-update.query.svelte';
	import { updateStatusQuery } from '$lib/app/application/queries/update-status.query.svelte';

	const KIND_LABELS: Readonly<Record<UpdateChange['kind'], string>> = {
		feature: 'New',
		fix: 'Fix',
		perf: 'Faster',
	};

	const status = $derived(updateStatusQuery.data);

	function kindsOf(release: UpdateRelease): UpdateChange['kind'][] {
		return [...new Set(release.changes.map((change) => change.kind))];
	}

	function behind(count: number): string {
		return `${count} ${count === 1 ? 'release' : 'releases'} behind`;
	}
</script>

{#if status.state !== 'idle'}
	<div class="shrink-0 px-2 py-1.5">
		{#if status.state === 'ready'}
			<HoverCard
				side="top"
				align="start"
				openDelay={160}
				closeDelay={140}
				triggerPress="dismiss"
				triggerClass="w-full"
				testId="update-releases-card"
				panelClass="w-84 rounded-[18px] border-[0.5px] border-surface-elevated-border bg-surface-root p-1.5"
			>
				{#snippet trigger({ open })}
					<Button
						variant="primary-soft"
						size="sm"
						class="w-full"
						active={open}
						loading={restartingToUpdateQuery.data}
						ariaLabel={`Restart to update to malini ${status.version}`}
						ariaExpanded={open}
						ariaHasPopup="dialog"
						onclick={restartToUpdateCommand}
					>
						{#snippet leading()}
							<Icon name="gift" size={14} />
						{/snippet}
						<span class="text-painting">Restart to update</span>
						{#snippet trailing()}
							<span class="tabular-nums opacity-70">{status.version}</span>
						{/snippet}
					</Button>
				{/snippet}

				{#snippet content()}
					<div
						role="dialog"
						aria-label={`What changed since ${status.installed}`}
						class="flex flex-col gap-1.5"
					>
						<div
							class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-3 py-2.5"
						>
							<div class="flex items-baseline gap-1.5 tabular-nums">
								<span class="text-fg-tertiary text-xs">{status.installed}</span>
								<span class="text-fg-quaternary text-xs" aria-hidden="true">→</span>
								<h3 class="text-painting text-sm font-medium">{status.version}</h3>
								{#if status.releases.length > 0}
									<span class="text-fg-tertiary ml-auto text-xs">
										{behind(status.releases.length)}
									</span>
								{/if}
							</div>
							{#if status.releases.length > 0}
								<ol
									class="border-surface-50-border mt-2.5 max-h-[min(440px,60vh)] overflow-y-auto border-t-[0.5px] pt-3"
									aria-label="Releases"
								>
									{#each status.releases as release, index (release.version)}
										<li class="relative pb-3 pl-5 last:pb-0">
											{#if index < status.releases.length - 1}
												<span
													class="bg-surface-50-border absolute top-4.5 -bottom-0.5 left-[4px] w-px"
													aria-hidden="true"
												></span>
											{/if}
											<span
												class={[
													'ring-surface-50 absolute top-1.5 left-0 size-[9px] rounded-full ring-2',
													index === 0 ? 'bg-painting' : 'bg-surface-150',
												]}
												aria-hidden="true"
											></span>
											<div class="flex h-5 items-center gap-1.5">
												<span class="text-fg-secondary text-xs tabular-nums">
													{release.version}
												</span>
												{#each kindsOf(release) as kind (kind)}
													<Badge variant="neutral" class="text-2xs px-1.5 py-0 leading-4">
														{KIND_LABELS[kind]}
													</Badge>
												{/each}
											</div>
											{#each release.changes as change, changeIndex (changeIndex)}
												<p class="text-fg-default mt-0.5 text-xs leading-5">{change.summary}</p>
											{/each}
										</li>
									{/each}
								</ol>
							{/if}
						</div>
						<p class="text-fg-tertiary px-3 pb-1 text-xs">Takes a second. Chats carry on</p>
					</div>
				{/snippet}
			</HoverCard>
		{:else if status.state === 'failed'}
			<Tooltip content={status.error} placement="right" class="w-full">
				<Button
					variant="ghost"
					size="sm"
					class="w-full"
					ariaLabel="Update failed, check again"
					onclick={checkForUpdatesCommand}
				>
					{#snippet leading()}
						<Icon name="warning" size={14} class="text-warning-content" />
					{/snippet}
					Update failed
					{#snippet trailing()}
						<span class="opacity-70">Retry</span>
					{/snippet}
				</Button>
			</Tooltip>
		{:else}
			<div
				role="status"
				class="text-fg-secondary text-2xs flex h-6 items-center justify-center gap-1.5 px-2 font-medium whitespace-nowrap"
			>
				{#if status.state === 'up-to-date'}
					<Icon name="check" size={14} class="text-success-content shrink-0" />
					<span class="min-w-0 truncate">Malini is up to date</span>
					<span class="tabular-nums opacity-70">{status.version}</span>
				{:else if status.state === 'downloading'}
					<BusyIcon size={14} class="shrink-0" />
					<span class="min-w-0 truncate">Downloading update</span>
					<span class="tabular-nums opacity-70">{status.version}</span>
				{:else}
					<BusyIcon size={14} class="shrink-0" />
					<span class="min-w-0 truncate">Checking for updates…</span>
				{/if}
			</div>
		{/if}
	</div>
{/if}
