<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { onMount } from 'svelte';
	import {
		ClaudeCodeSetup,
		DEEPSEEK_BASE_URL,
		DEEPSEEK_MODELS,
		DEEPSEEK_PROVIDER_ID,
		DEEPSEEK_PROVIDER_NAME,
		ProviderKeyCard,
		loadModelProvidersCommand,
		providerGroupsQuery,
	} from '$shared/providers/providers.api';
	import SettingsSection from './SettingsSection.svelte';

	const deepseek = $derived(
		providerGroupsQuery.data.find((group) => group.id === DEEPSEEK_PROVIDER_ID),
	);

	onMount(loadModelProvidersCommand);
</script>

<SettingsSection
	title="Providers"
	description="Chats run Claude Code on this Mac. Choose what it runs as: your Claude account, or an Anthropic-compatible provider with its own API key."
>
	<Well title="Claude Code" headed={false}>
		<ClaudeCodeSetup nested />
	</Well>
	<Well title="DeepSeek" headed={false}>
		<ProviderKeyCard
			providerId={DEEPSEEK_PROVIDER_ID}
			name={DEEPSEEK_PROVIDER_NAME}
			baseUrl={DEEPSEEK_BASE_URL}
			models={DEEPSEEK_MODELS}
			keySaved={deepseek?.ready ?? false}
		/>
	</Well>
</SettingsSection>
