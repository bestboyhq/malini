<script lang="ts">
	import { Select } from '$hyper-ui/components/select';
	import { saveAgentAccessDefaultCommand } from '$shared/providers/application/commands/save-agent-access-default.command';
	import { agentAccessDefaultQuery } from '$shared/providers/application/queries/agent-access-default.query.svelte';
	import {
		AGENT_ACCESS_DETAILS,
		AGENT_ACCESS_LEVELS,
		isValidAgentAccess,
	} from '$shared/providers/domain/run-profile';

	const options = AGENT_ACCESS_LEVELS.map((access) => ({
		value: access,
		label: AGENT_ACCESS_DETAILS[access].label,
	}));
	const access = $derived(agentAccessDefaultQuery.data);

	function select(value: string): void {
		if (isValidAgentAccess(value)) saveAgentAccessDefaultCommand(value);
	}
</script>

<section aria-labelledby="agent-access-heading">
	<h2 id="agent-access-heading" class="text-fg-default text-sm font-medium">Agent access</h2>

	<div
		class="border-surface-50-border bg-surface-50 mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-2xl border-[0.5px] px-4 py-3"
	>
		<div class="min-w-0">
			<h3 class="text-fg-default text-sm font-medium">Default access</h3>
			<p class="text-fg-tertiary text-xs">
				{AGENT_ACCESS_DETAILS[access].description} Each workstream can change it from the composer.
			</p>
		</div>
		<Select
			ariaLabel="Default agent access"
			value={access}
			{options}
			onchange={select}
			data-testid="agent-access-default"
		/>
	</div>
</section>
