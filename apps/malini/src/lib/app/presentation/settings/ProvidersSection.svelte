<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { onMount } from 'svelte';
	import {
		ClaudeCodeSetup,
		ProviderKeyCard,
		providerGroupsQuery,
		refreshModelProvidersCommand,
	} from '$shared/providers/providers.api';
	import SettingsSection from './SettingsSection.svelte';

	const keyed = $derived(providerGroupsQuery.data.filter((group) => group.kind !== 'claude'));

	onMount(refreshModelProvidersCommand);
</script>

<SettingsSection
	title="Providers"
	description="Chats run Claude Code on this Mac. Choose what it runs as: your Claude account, or a provider with its own API key, such as DeepSeek or OpenCode."
>
	<Well title="Claude Code" headed={false}>
		<ClaudeCodeSetup nested />
	</Well>
	{#each keyed as provider (provider.id)}
		<Well title={provider.name} headed={false}>
			<ProviderKeyCard {provider} />
		</Well>
	{/each}
</SettingsSection>
