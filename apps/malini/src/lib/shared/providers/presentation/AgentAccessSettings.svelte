<script lang="ts">
	import { Select } from '$hyper-ui/components/select';
	import { osQuery } from '$shared/os/os.api';
	import { saveAgentAccessDefaultCommand } from '$shared/providers/application/commands/save-agent-access-default.command';
	import { agentAccessDefaultQuery } from '$shared/providers/application/queries/agent-access-default.query.svelte';
	import { sandboxProblemQuery } from '$shared/providers/application/queries/sandbox-problem.query.svelte';
	import {
		AGENT_ACCESS_DETAILS,
		AGENT_ACCESS_LEVELS,
		isValidAgentAccess,
		sandboxProblemLine,
	} from '$shared/providers/domain/run-profile';

	const options = AGENT_ACCESS_LEVELS.map((access) => ({
		value: access,
		label: AGENT_ACCESS_DETAILS[access].label,
	}));
	const access = $derived(agentAccessDefaultQuery.data);
	const sandboxProblem = $derived(
		access === 'sandboxed'
			? sandboxProblemLine(sandboxProblemQuery.data, osQuery.data.platform)
			: null,
	);

	$effect(() => void sandboxProblemQuery.load());

	function select(value: string): void {
		if (isValidAgentAccess(value)) saveAgentAccessDefaultCommand(value);
	}
</script>

<div
	class="border-surface-50-border bg-surface-50 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border-[0.5px] px-4 py-3"
>
	<div class="min-w-0">
		<h3 class="text-fg-default text-sm font-medium">Default access</h3>
		<p class="text-fg-tertiary text-xs">
			{sandboxProblem ?? AGENT_ACCESS_DETAILS[access].description} Each workstream can change it from
			the composer.
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
