<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown } from '$hyper-ui/components/dropdown';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';
	import ClaudeAccountList from './ClaudeAccountList.svelte';

	let open = $state(false);

	const status = $derived(claudeCodeStatusQuery.data);
	const email = $derived(status.kind === 'ready' ? (status.account?.email ?? null) : null);
</script>

{#if status.kind === 'ready'}
	<Dropdown
		bind:open
		side="top"
		align="start"
		role={null}
		keyboardNavigation={false}
		panelClass="w-72"
		contentClass="p-1.5"
		owner="chat-composer"
	>
		{#snippet trigger()}
			<Button
				bare
				class={[
					'text-2xs flex h-6 max-w-64 min-w-0 cursor-pointer items-center gap-1 select-none',
					open ? 'text-fg-secondary' : 'text-fg-tertiary hover:text-fg-secondary',
				]}
				ariaLabel={`Claude account: ${email ?? 'signed in'}`}
				ariaHasPopup="dialog"
				ariaExpanded={open}
			>
				<span class="min-w-0 truncate">
					{#if email}
						<SensitiveText text={email} interactive={false} />
					{:else}
						Signed in
					{/if}
				</span>
				<Icon
					name="chevron-down"
					size={12}
					class={['shrink-0 transition-transform duration-150', open && 'rotate-180']}
				/>
			</Button>
		{/snippet}
		{#snippet content()}
			<div role="dialog" aria-label="Switch Claude account">
				<ClaudeAccountList />
			</div>
		{/snippet}
	</Dropdown>
{/if}
