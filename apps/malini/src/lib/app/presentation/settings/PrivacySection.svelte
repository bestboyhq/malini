<script lang="ts">
	import UsageDataSettings from '../UsageDataSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import Well from './Well.svelte';
</script>

<SettingsSection title="Privacy" description="What malini sends off this Mac.">
	<Well title="Usage data" headed={false}>
		<UsageDataSettings />
	</Well>
</SettingsSection>
