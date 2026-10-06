<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Modal } from '$hyper-ui/components/modal';
	import { cancelCloseCommand } from '$lib/app/application/commands/cancel-close.command';
	import { confirmCloseCommand } from '$lib/app/application/commands/confirm-close.command';
	import { closeConfirmationQuery } from '$lib/app/application/queries/close-confirmation.query.svelte';

	const confirmation = $derived(closeConfirmationQuery.data);
</script>

<Modal
	open={confirmation.open}
	size="sm"
	title="Close malini"
	closeDisabled={confirmation.closing}
	closeOnBackdrop={!confirmation.closing}
	onclose={cancelCloseCommand}
	navigationTarget="close-confirmation"
>
	<div class="flex flex-col gap-5" data-testid="close-confirmation">
		{#if confirmation.checking}
			<p class="text-fg-secondary text-sm">Checking what malini is running…</p>
		{:else if confirmation.impactFailed}
			<p class="text-fg-secondary text-sm">
				malini could not check what it is running. Closing now may interrupt work in progress.
			</p>
		{:else if confirmation.idle}
			<p class="text-fg-secondary text-sm">
				Nothing malini started is still running. Closing interrupts nothing.
			</p>
		{:else}
			<div class="flex flex-col gap-3">
				<p class="text-fg-default text-sm">Closing shuts down everything malini started:</p>
				<ul class="flex flex-col gap-2">
					{#each confirmation.lines as line (line.key)}
						<li class="flex items-baseline gap-2.5 text-sm">
							<span class="text-fg-default min-w-6 shrink-0 text-right font-semibold tabular-nums">
								{line.count}
							</span>
							<span class="text-fg-secondary">
								<span class="text-fg-default">{line.noun}</span>
								{line.consequence}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if confirmation.closing}
			<p class="text-fg-secondary text-sm" aria-live="polite" data-testid="close-progress">
				Stopping what malini started…
			</p>
		{/if}

		{#if confirmation.destroyFailed}
			<p class="text-error-content text-sm" role="alert">
				malini could not close the window. Quit from the menu bar if this keeps happening.
			</p>
		{/if}

		{#if confirmation.unfinishedContainers.length > 0}
			<p class="text-fg-secondary text-sm">
				malini could not stop {confirmation.unfinishedContainers.length}
				{confirmation.unfinishedContainers.length === 1 ? 'container' : 'containers'}. The next
				launch removes
				{confirmation.unfinishedContainers.length === 1 ? 'it' : 'them'}.
			</p>
		{/if}

		<div class="flex items-center justify-end gap-2">
			<Button variant="secondary" disabled={confirmation.closing} onclick={cancelCloseCommand}>
				Keep working
			</Button>
			<Button
				variant="danger"
				disabled={confirmation.closing}
				ariaBusy={confirmation.closing}
				onclick={confirmCloseCommand}
			>
				{confirmation.closing ? 'Closing…' : 'Close malini'}
			</Button>
		</div>
	</div>
</Modal>
