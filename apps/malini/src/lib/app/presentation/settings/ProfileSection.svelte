<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { MomentSettings, PublishStatsSettings } from '$lib/stats/stats.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Profile"
	description="Your public profile at bestboy.dev, and the Bestboy account Malini publishes it with."
>
	<Well title="Profile" headed={false}>
		<PublishStatsSettings />
	</Well>
	<Well title="Milestone cards" headed={false}>
		<MomentSettings />
	</Well>
</SettingsSection>
