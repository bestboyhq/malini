<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { AgentAccessSettings, ClaudeCodeSettings } from '$shared/providers/providers.api';
	import UsageDataSettings from '../UsageDataSettings.svelte';
</script>

<svelte:head>
	<title>malini · Settings</title>
</svelte:head>

<main class="native-band-row-reserve h-full min-h-0 overflow-y-auto" data-testid="settings-page">
	<div class="mx-auto w-full max-w-[640px] px-6 pt-6 pb-16">
		<Button
			href="/"
			variant="ghost"
			size="sm"
			class="-ml-2"
			ariaLabel="Back to workstreams"
			data-testid="settings-back"
		>
			{#snippet leading()}
				<Icon name="chevron-left" size={14} />
			{/snippet}
			Back
		</Button>

		<h1 class="text-fg-default mt-8 text-xl font-semibold tracking-tight">Settings</h1>

		<div class="mt-8">
			<ClaudeCodeSettings />
		</div>

		<div class="mt-10">
			<AgentAccessSettings />
		</div>

		<div class="mt-10">
			<UsageDataSettings />
		</div>
	</div>
</main>
