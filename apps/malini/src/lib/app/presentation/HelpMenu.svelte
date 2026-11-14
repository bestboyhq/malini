<script lang="ts">
	import { onMount } from 'svelte';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BrandIcon, Icon } from '$hyper-ui/icons';
	import { DISCORD_URL } from '$lib/app/domain/problem-report';
	import { loadRuntimeInfoCommand } from '$lib/app/application/commands/load-runtime-info.command';
	import { openExternalUrlCommand } from '$lib/app/application/commands/open-external-url.command';
	import { openProblemReportCommand } from '$lib/app/application/commands/open-problem-report.command';
	import { runtimeInfoQuery } from '$lib/app/application/queries/runtime-info.query.svelte';

	let open: boolean = $state(false);
	const version = $derived(runtimeInfoQuery.data?.app);

	onMount(loadRuntimeInfoCommand);
</script>

<Dropdown
	bind:open
	side="top"
	align="end"
	sideOffset={6}
	role={null}
	panelClass="w-76"
	testId="help-layer"
>
	{#snippet trigger()}
		<Tooltip content="Help and feedback" placement="top" suppressed={open}>
			<IconButton
				variant="ghost"
				size="sm"
				ariaLabel="Help and feedback"
				ariaHasPopup="menu"
				ariaExpanded={open}
				active={open}
				data-testid="sidebar-open-help"
			>
				<Icon name="question" size={14} />
			</IconButton>
		</Tooltip>
	{/snippet}

	{#snippet content()}
		<div role="menu" aria-label="Help and feedback">
			<div class="px-2 py-1.5 text-[13px] leading-[18px]">
				<p class="text-fg-default font-medium">
					Beta
					{#if version}<span class="tabular-nums">{version}</span>{/if}
				</p>
				<p class="text-fg-tertiary text-xs">Ships about five times a day</p>
			</div>
			<div class="border-border-subtle mx-1 my-1 border-t-[0.5px]" role="separator"></div>
			<DropdownItem
				role="menuitem"
				class="items-start gap-2.5 py-1.5"
				onSelect={openProblemReportCommand}
			>
				<Icon name="bug" size={15} class="mt-0.5 shrink-0" />
				{@render lines('Report a problem', 'Goes to GitHub once you give it a look')}
			</DropdownItem>
			<DropdownItem
				role="menuitem"
				class="items-start gap-2.5 py-1.5"
				onSelect={() => openExternalUrlCommand(DISCORD_URL)}
			>
				<BrandIcon brand="discord" size={15} class="mt-0.5 shrink-0" />
				{@render lines('Join the Discord', 'Malini people, helpful ones included')}
			</DropdownItem>
		</div>
	{/snippet}
</Dropdown>

{#snippet lines(label: string, line: string)}
	<span class="flex min-w-0 flex-1 flex-col text-left">
		<span class="text-fg-default">{label}</span>
		<span class="text-fg-tertiary text-xs">{line}</span>
	</span>
{/snippet}
