<script lang="ts">
	import { SecretsSettings } from '$lib/secrets/secrets.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Secrets"
	description="What agents asked you for, set in every command they run. Values stay sealed in your Mac's keychain and never show."
>
	<SecretsSettings />
</SettingsSection>
