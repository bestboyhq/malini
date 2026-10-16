<script lang="ts">
	import StreamerModeSettings from '../StreamerModeSettings.svelte';
	import UsageDataSettings from '../UsageDataSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import Well from './Well.svelte';
</script>

<SettingsSection title="Privacy" description="What malini sends off this Mac and shows on screen.">
	<Well title="Privacy" headed={false}>
		<div
			class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
		>
			<UsageDataSettings />
			<StreamerModeSettings />
		</div>
	</Well>
</SettingsSection>
