<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { PublishStatsSettings } from '$lib/stats/stats.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Profile"
	description="Your public profile at bestboy.dev, and the Bestboy account Malini publishes it with."
>
	<Well title="Profile" headed={false}>
		<PublishStatsSettings />
	</Well>
</SettingsSection>
