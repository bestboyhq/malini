<script lang="ts">
	import { Switch } from '$hyper-ui/components/switch';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { setPlanSyncCommand } from '$lib/initiatives/application/commands/set-plan-sync.command';
	import { planSyncQuery } from '$lib/initiatives/application/queries/plan-sync.query.svelte';
	import PlanSyncStatus from './PlanSyncStatus.svelte';

	interface Props {
		repositoryFullName: string;
		compact: boolean;
	}

	let { repositoryFullName, compact }: Props = $props();

	const LABEL = 'Sync with GitHub';
	const WHAT_ON_DOES =
		'Outcomes become milestones and dependencies become issues. Everyone with access to the repository sees them.';
	const WHAT_OFF_DOES = 'Turning it off stops syncing. GitHub keeps what it has.';

	const switchId = $props.id();

	const sync = $derived(planSyncQuery.data(repositoryFullName));

	function onchange(checked: boolean): void {
		setPlanSyncCommand(repositoryFullName, checked);
	}
</script>

{#if sync && compact}
	<Tooltip content={WHAT_ON_DOES} placement="top" class="flex min-w-0 items-center gap-2">
		<Switch id={switchId} size="sm" checked={sync.enabled} {onchange} />
		<label for={switchId} class="min-w-0 cursor-pointer truncate">{LABEL}</label>
	</Tooltip>
{:else if sync}
	<div class="mb-5 flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<label for={switchId} class="text-fg-default cursor-pointer text-sm font-medium">
				{LABEL}
			</label>
			{#if sync.enabled}
				<div class="text-3xs text-fg-tertiary mt-1 flex h-4 max-w-80 items-center gap-2">
					<PlanSyncStatus {sync} />
				</div>
			{/if}
			<p class="text-2xs text-fg-tertiary mt-1">{sync.enabled ? WHAT_OFF_DOES : WHAT_ON_DOES}</p>
		</div>
		<Switch id={switchId} size="sm" checked={sync.enabled} class="mt-0.5" {onchange} />
	</div>
{/if}
