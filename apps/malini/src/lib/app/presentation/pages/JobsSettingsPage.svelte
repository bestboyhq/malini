<script lang="ts">
	import JobSettings from '../JobSettings.svelte';
	import SettingsSection from '../settings/SettingsSection.svelte';
	import Well from '../settings/Well.svelte';
</script>

<svelte:head>
	<title>malini · Jobs</title>
</svelte:head>

<SettingsSection title="Jobs" description="How much background work malini takes on by itself.">
	<Well title="Jobs" headed={false} class="max-w-[720px]">
		<JobSettings />
	</Well>
</SettingsSection>
