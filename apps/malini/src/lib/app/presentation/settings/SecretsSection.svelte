<script lang="ts">
	import { SecretsSettings } from '$lib/secrets/secrets.api';
	import { osQuery } from '$shared/os/os.api';
	import SettingsSection from './SettingsSection.svelte';

	const description = $derived(
		`What agents asked you for, set in every command they run. Values stay sealed in your ${osQuery.data.machineKeychain} and never show.`,
	);
</script>

<SettingsSection title="Secrets" {description}>
	<SecretsSettings />
</SettingsSection>
