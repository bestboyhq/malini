<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import {
		provisioningStepLabel,
		type WorkstreamProvisioningRecord,
	} from '$shared/repositories/domain/provisioning';
	import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';

	interface Props {
		record: WorkstreamProvisioningRecord;
		failure: string;
		retrying: boolean;
		onretry: () => void;
		onremove: () => void;
	}

	let { record, failure, retrying, onretry, onremove }: Props = $props();

	const label = $derived(
		displayWorkstreamName(
			{ id: record.plan.workstreamId, name: record.plan.name, baseBranch: record.plan.baseBranch },
			record.plan.repositoryFullName,
		),
	);
</script>

<div
	role="alert"
	data-testid="workstream-provisioning-failure"
	data-workstream-id={record.plan.workstreamId}
	class="border-surface-50-border bg-surface-50 flex w-full shrink-0 items-center gap-3 border-b px-4 py-2"
>
	<span class="text-error-content grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
		<Icon name="warning" size={13} />
	</span>
	<div class="min-w-0 flex-1">
		<p class="text-2xs text-fg-default leading-4 font-medium">
			{provisioningStepLabel(record)} failed, so {label} has no worktree yet
		</p>
		<Tooltip content={failure} placement="bottom" class="block min-w-0">
			<span
				class="text-2xs text-fg-tertiary block truncate font-mono leading-4"
				data-testid="workstream-provisioning-failure-detail"
			>
				{failure}
			</span>
		</Tooltip>
	</div>
	<Button
		variant="secondary"
		size="sm"
		ariaLabel={`Retry setting up ${label}`}
		disabled={retrying}
		ariaBusy={retrying}
		data-testid="workstream-provisioning-retry"
		onclick={() => onretry()}
	>
		<Icon name="refresh" size={13} />
		{retrying ? 'Retrying…' : 'Retry setup'}
	</Button>
	<Button
		variant="ghost"
		size="sm"
		ariaLabel={`Remove ${label}`}
		disabled={retrying}
		data-testid="workstream-provisioning-remove"
		onclick={() => onremove()}
	>
		<Icon name="trash" size={13} />
		Remove
	</Button>
</div>
