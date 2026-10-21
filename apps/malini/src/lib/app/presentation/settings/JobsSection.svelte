<script lang="ts">
	import JobSettings from '../JobSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import Well from './Well.svelte';
</script>

<SettingsSection title="Jobs" description="How much background work Malini takes on by itself.">
	<Well title="Jobs" headed={false}>
		<JobSettings />
	</Well>
</SettingsSection>
