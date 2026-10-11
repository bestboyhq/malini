<script lang="ts">
	import SettingsSection from '../settings/SettingsSection.svelte';
	import Well from '../settings/Well.svelte';
	import UsageDataSettings from '../UsageDataSettings.svelte';
</script>

<svelte:head>
	<title>malini · Privacy</title>
</svelte:head>

<SettingsSection title="Privacy" description="What malini sends off this Mac.">
	<Well title="Usage data" headed={false} class="max-w-[720px]">
		<UsageDataSettings />
	</Well>
</SettingsSection>
