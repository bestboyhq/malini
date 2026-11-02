<script lang="ts">
	import { ClaudeIcon, DeepSeekIcon, Icon, type IconProps } from '$hyper-ui/icons';
	import { CLAUDE_PROVIDER_ID, DEEPSEEK_PROVIDER_ID } from '$shared/providers/domain/provider';

	interface Props extends IconProps {
		providerId: string;
	}

	let { providerId, ...icon }: Props = $props();
</script>

{#if providerId === CLAUDE_PROVIDER_ID}
	<ClaudeIcon {...icon} />
{:else if providerId === DEEPSEEK_PROVIDER_ID}
	<DeepSeekIcon {...icon} />
{:else}
	<Icon name="bolt" {...icon} />
{/if}
