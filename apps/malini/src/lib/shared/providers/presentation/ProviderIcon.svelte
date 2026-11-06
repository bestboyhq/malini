<script lang="ts">
	import {
		BrandIcon,
		ClaudeIcon,
		DeepSeekIcon,
		Icon,
		OpenCodeIcon,
		type IconProps,
	} from '$hyper-ui/icons';
	import {
		CHATGPT_PROVIDER_ID,
		CLAUDE_PROVIDER_ID,
		DEEPSEEK_PROVIDER_ID,
		OPENCODE_PROVIDER_ID,
	} from '$shared/providers/domain/provider';

	interface Props extends IconProps {
		providerId: string;
	}

	let { providerId, ...icon }: Props = $props();
</script>

{#if providerId === CLAUDE_PROVIDER_ID}
	<ClaudeIcon {...icon} />
{:else if providerId === DEEPSEEK_PROVIDER_ID}
	<DeepSeekIcon {...icon} />
{:else if providerId === OPENCODE_PROVIDER_ID}
	<OpenCodeIcon {...icon} />
{:else if providerId === CHATGPT_PROVIDER_ID}
	<BrandIcon brand="openai" {...icon} />
{:else}
	<Icon name="bolt" {...icon} />
{/if}
