<script lang="ts">
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';
	import { JobsNavBadge } from '$lib/jobs/jobs.api';
	import { StatsReadout } from '$lib/stats/stats.api';
	import UpdateStatus from './UpdateStatus.svelte';
</script>

<UpdateStatus />

<div
	class="border-surface-50-border flex shrink-0 items-center gap-1 border-t py-1.5 pr-1.5 pl-2.5"
>
	<Tooltip content="Connect repository" placement="right">
		<IconButton
			variant="ghost"
			size="sm"
			href={REPOSITORIES_HREF}
			ariaLabel="Connect repository"
			data-testid="sidebar-connect-repository"
			data-navigation-path-id="expected-path:workstream-sidebar.connect-repository"
		>
			<Icon name="folder-open" size={15} />
		</IconButton>
	</Tooltip>
	<JobsNavBadge />
	<Tooltip content="Settings" placement="right">
		<IconButton
			variant="ghost"
			size="sm"
			href="/settings"
			ariaLabel="Open settings"
			data-testid="sidebar-open-settings"
		>
			<Icon name="settings" size={15} />
		</IconButton>
	</Tooltip>
	<StatsReadout />
</div>
