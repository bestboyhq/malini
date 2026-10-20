<script lang="ts">
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { SensitiveText } from '$hyper-ui/components/sensitive';

	interface Props {
		others: readonly string[];
		onswitch: (email: string | null) => void;
	}

	let { others, onswitch }: Props = $props();
</script>

{#each others as email (email)}
	<DropdownItem
		class="py-2"
		aria-label={`Switch to ${email}`}
		data-testid="claude-account-switch"
		onSelect={() => onswitch(email)}
	>
		<span class="min-w-0 flex-1 truncate">
			Switch to <SensitiveText text={email} interactive={false} />
		</span>
	</DropdownItem>
{/each}
<DropdownItem class="py-2" data-testid="claude-account-sign-in" onSelect={() => onswitch(null)}>
	<span class="min-w-0 flex-1 truncate">Sign in with another account</span>
</DropdownItem>
