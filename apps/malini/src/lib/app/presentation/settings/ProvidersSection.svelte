<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { onMount } from 'svelte';
	import { osQuery } from '$shared/os/os.api';
	import {
		ChatGptCard,
		ClaudeCodeSetup,
		ProviderKeyCard,
		providerGroupsQuery,
		refreshModelProvidersCommand,
		updateClaudeCodeCommand,
	} from '$shared/providers/providers.api';
	import SettingsSection from './SettingsSection.svelte';

	const description = $derived(
		`Chats run Claude Code on this ${osQuery.data.machine}. Choose what it runs as: your Claude account, your ChatGPT plan, or a provider with its own API key, such as DeepSeek or OpenCode.`,
	);
	const others = $derived(providerGroupsQuery.data.filter((group) => group.kind !== 'claude'));

	onMount(() => {
		refreshModelProvidersCommand();
		updateClaudeCodeCommand();
	});
</script>

<SettingsSection title="Providers" {description}>
	<Well title="Claude Code" headed={false}>
		<ClaudeCodeSetup nested />
	</Well>
	{#each others as provider (provider.id)}
		<Well title={provider.name} headed={false}>
			{#if provider.kind === 'chatgpt'}
				<ChatGptCard {provider} />
			{:else}
				<ProviderKeyCard {provider} />
			{/if}
		</Well>
	{/each}
</SettingsSection>
