<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import JobSettings from '../JobSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection title="Jobs" description="How much background work Malini takes on by itself.">
	<Well title="Jobs" headed={false}>
		<JobSettings />
	</Well>
</SettingsSection>
