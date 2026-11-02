<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { GitHubSetup } from '$shared/repositories/repositories.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Accounts"
	description="Clones and pull requests go through your GitHub account. Model providers live in Providers."
>
	<Well title="GitHub" headed={false}>
		<GitHubSetup nested />
	</Well>
</SettingsSection>
