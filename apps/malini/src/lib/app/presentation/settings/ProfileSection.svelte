<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { PublishExtensionsSettings } from '$lib/extensions/extensions.api';
	import { MomentSettings, PublishStatsSettings } from '$lib/stats/stats.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Profile"
	description="Your public profile at bestboy.dev, the extensions you publish there, and the Bestboy account Malini uses for both."
>
	<Well title="Profile" headed={false}>
		<PublishStatsSettings />
	</Well>
	<Well title="Milestone cards" headed={false}>
		<MomentSettings />
	</Well>
	<Well title="Extensions you publish">
		<PublishExtensionsSettings />
	</Well>
</SettingsSection>
