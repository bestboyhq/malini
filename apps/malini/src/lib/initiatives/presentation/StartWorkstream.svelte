<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import {
		RepositoryAvatar,
		repositoryName,
		repositoryOwner,
		type Repository,
	} from '$shared/repositories/repositories.api';

	interface Props {
		repositories: readonly Repository[];
		onstart: (repository: Repository) => void;
	}

	let { repositories, onstart }: Props = $props();

	const HOVER_CLASS = 'group-hover/row:bg-button-secondary-hover group-hover/row:text-fg-default';

	let open: boolean = $state(false);

	const only = $derived(repositories.length === 1 ? repositories[0] : undefined);
</script>

{#if only}
	<Button variant="secondary" size="sm" bordered class={HOVER_CLASS} onclick={() => onstart(only)}>
		Start workstream
	</Button>
{:else if repositories.length > 1}
	<Dropdown bind:open side="bottom" align="end">
		{#snippet trigger()}
			<Button
				variant="secondary"
				size="sm"
				bordered
				class={HOVER_CLASS}
				ariaHasPopup="menu"
				ariaExpanded={open}
			>
				Start workstream
			</Button>
		{/snippet}
		{#snippet content()}
			<div class="w-60">
				{#each repositories as repository (repository.id)}
					{@const owner = repositoryOwner(repository.fullName)}
					<DropdownItem
						role="menuitem"
						aria-label={repository.fullName}
						onSelect={() => onstart(repository)}
					>
						<RepositoryAvatar fullName={repository.fullName} size={16} />
						<span class="flex min-w-0 flex-1">
							{#if owner}
								<span class="text-fg-tertiary shrink-0">
									<SensitiveText text={`${owner}/`} interactive={false} />
								</span>
							{/if}
							<span class="truncate">
								<SensitiveText text={repositoryName(repository.fullName)} interactive={false} />
							</span>
						</span>
					</DropdownItem>
				{/each}
			</div>
		{/snippet}
	</Dropdown>
{/if}
