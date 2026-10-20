<script lang="ts">
	import { SkillPresetBoard } from '$lib/skills/skills.api';
	import JobSettings from '../JobSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import Well from './Well.svelte';
</script>

<SettingsSection title="Jobs" description="How much background work Malini takes on by itself.">
	<div class="flex flex-col gap-1.5">
		<Well title="Jobs" headed={false}>
			<JobSettings />
		</Well>
		<Well title="Skill presets" note="A job can load one instead of every skill">
			<SkillPresetBoard class="h-[min(480px,calc(100vh_-_18rem))]" />
		</Well>
	</div>
</SettingsSection>
