<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { SoundChoices } from '$shared/sounds/sounds.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Sounds"
	description="What you hear when an agent finishes, and when it needs you."
>
	<Well title="Sounds" headed={false}>
		<SoundChoices class="bg-surface-50 rounded-xl" />
	</Well>
</SettingsSection>
