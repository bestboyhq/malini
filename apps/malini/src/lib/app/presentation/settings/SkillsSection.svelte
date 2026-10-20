<script lang="ts">
	import { SkillUsageList } from '$lib/skills/skills.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Skills"
	description="Ranked by how often your agents use them. Turn one off and it leaves every chat, here and in the terminal."
>
	<SkillUsageList />
</SettingsSection>
