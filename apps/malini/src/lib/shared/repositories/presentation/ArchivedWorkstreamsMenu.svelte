<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { restoreWorkstreamCommand } from '$shared/repositories/application/commands/restore-workstream.command';
	import { archivedWorkstreamsQuery } from '$shared/repositories/application/queries/archived-workstreams.query.svelte';
	import { workstreamBusyActionQuery } from '$shared/repositories/application/queries/workstream-busy-action.query.svelte';
	import { repositoryName } from '$shared/repositories/domain/repository-context';
	import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
	import RepositoryAvatar from './RepositoryAvatar.svelte';

	const ARCHIVED_AT_FORMAT = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});

	let open = $state(false);
	let triggerEl: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	const archived = $derived(archivedWorkstreamsQuery.data);
	const busyActionFor = $derived(workstreamBusyActionQuery.data);

	function close(): void {
		open = false;
	}

	function archivedAt(iso: string): string {
		const parsed = new Date(iso);
		return Number.isNaN(parsed.getTime()) ? '' : ARCHIVED_AT_FORMAT.format(parsed);
	}

	function detail(repositoryFullName: string | null, iso: string): string {
		return [repositoryFullName ? repositoryName(repositoryFullName) : null, archivedAt(iso)]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<Tooltip content="Archived workstreams" placement="right" suppressed={open}>
	<IconButton
		bind:element={triggerEl}
		variant="ghost"
		size="sm"
		onclick={() => (open = !open)}
		ariaLabel="Archived workstreams"
		ariaHasPopup="menu"
		ariaExpanded={open}
		active={open}
		data-testid="sidebar-open-archived"
	>
		<Icon name="archive" size={15} />
	</IconButton>
</Tooltip>

<DropdownLayer
	{open}
	anchor={triggerEl}
	onclose={close}
	side="top"
	align="start"
	role={null}
	panelClass="w-64 overflow-hidden rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated"
	testId="archived-workstreams-menu"
>
	<p class="text-fg-tertiary px-3.5 pt-2.5 pb-1 text-xs font-medium">Archived</p>
	{#if archived.length === 0}
		<p class="text-fg-secondary px-3.5 pb-3 text-[13px]">Nothing archived yet.</p>
	{:else}
		<div role="menu" aria-label="Archived workstreams" class="max-h-80 overflow-y-auto p-1">
			{#each archived as workstream (workstream.id)}
				{@const name = displayWorkstreamName(workstream, workstream.repositoryFullName)}
				{@const restoring = busyActionFor(workstream.id) === 'restore'}
				<DropdownItem
					role="menuitem"
					focusOnHover={false}
					class="group/archived gap-2.5 px-2.5 py-1.5"
					aria-label={`Restore ${name}`}
					aria-busy={restoring}
					disabled={restoring}
					data-testid="archived-workstream"
					data-workstream-id={workstream.id}
					onclick={() => restoreWorkstreamCommand(workstream.id, close)}
				>
					{#if workstream.repositoryFullName}
						<RepositoryAvatar fullName={workstream.repositoryFullName} size={18} />
					{:else}
						<span class="text-fg-tertiary grid h-[18px] w-[18px] shrink-0 place-items-center">
							<Icon name="archive" size={14} />
						</span>
					{/if}
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="text-fg-default truncate"><SensitiveText text={name} /></span>
						<span class="text-fg-tertiary truncate text-xs">
							{detail(workstream.repositoryFullName, workstream.archivedAt)}
						</span>
					</span>
					<span
						class={[
							'text-fg-tertiary flex shrink-0 items-center gap-1 text-xs',
							!restoring &&
								'opacity-0 group-hover/archived:opacity-100 group-focus-visible/archived:opacity-100',
						]}
						aria-hidden="true"
					>
						{#if restoring}
							<BusyIcon size={13} />
							Restoring
						{:else}
							<Icon name="undo" size={13} />
							Restore
						{/if}
					</span>
				</DropdownItem>
			{/each}
		</div>
	{/if}
</DropdownLayer>
