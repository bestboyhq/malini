<script lang="ts">
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BrandIcon, Icon } from '$hyper-ui/icons';
	import { DISCORD_URL } from '$lib/app/domain/problem-report';
	import { openExternalUrlCommand } from '$lib/app/application/commands/open-external-url.command';
	import { openProblemReportCommand } from '$lib/app/application/commands/open-problem-report.command';

	let open: boolean = $state(false);
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
			<DropdownItem
				role="menuitem"
				class="items-start gap-2.5 py-1.5"
				onSelect={openProblemReportCommand}
			>
				<Icon name="bug" size={15} class="mt-0.5 shrink-0" />
				{@render lines('Report a problem', 'Files a GitHub issue. You approve it first')}
			</DropdownItem>
			<DropdownItem
				role="menuitem"
				class="items-start gap-2.5 py-1.5"
				onSelect={() => openExternalUrlCommand(DISCORD_URL)}
			>
				<BrandIcon brand="discord" size={15} class="mt-0.5 shrink-0" />
				{@render lines('Join the Discord', 'Other Malini people. Some helpful')}
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
