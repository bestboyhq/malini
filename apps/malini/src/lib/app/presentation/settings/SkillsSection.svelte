<script lang="ts">
	import { SkillPresetBoard } from '$lib/skills/skills.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Skills"
	description="Group your skills into presets. A chat's agent loads only the skills of its preset."
>
	<SkillPresetBoard class="h-[min(560px,calc(100vh_-_14rem))]" />
</SettingsSection>
