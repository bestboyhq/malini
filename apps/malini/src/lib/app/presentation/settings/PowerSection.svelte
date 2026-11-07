<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import LidHoldSettings from '../LidHoldSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection title="Power" description="When your Mac may sleep while agents work.">
	<Well title="Power" headed={false}>
		<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px]">
			<LidHoldSettings />
		</div>
	</Well>
</SettingsSection>
