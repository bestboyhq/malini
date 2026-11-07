<script lang="ts">
	import { onMount } from 'svelte';
	import type { CheckoutsFolderProblem } from '$contract/repositories';
	import { Button } from '$hyper-ui/components/button';
	import { Well } from '$hyper-ui/components/well';
	import { chooseCheckoutsFolderCommand } from '$lib/app/application/commands/choose-checkouts-folder.command';
	import { keepCheckoutsFolderCommand } from '$lib/app/application/commands/keep-checkouts-folder.command';
	import { loadCheckoutsFolderCommand } from '$lib/app/application/commands/load-checkouts-folder.command';
	import { restartMaliniCommand } from '$lib/app/application/commands/restart-malini.command';
	import { checkoutsFolderQuery } from '$lib/app/application/queries/checkouts-folder.query.svelte';
	import SettingsSection from './SettingsSection.svelte';

	const PROBLEMS: Readonly<Record<CheckoutsFolderProblem, (folder: string) => string>> = {
		'inside-checkouts': (folder) =>
			`${folder} is inside the checkouts folder. Pick one outside it.`,
		'other-disk': (folder) => `${folder} is on another disk. Pick one on this disk.`,
		'not-empty': (folder) => `${folder} isn't empty. Pick an empty folder.`,
		'not-writable': (folder) => `Malini can't write to ${folder}.`,
		'move-failed': (folder) => `Malini couldn't move checkouts to ${folder}.`,
	};

	const checkouts = $derived(checkoutsFolderQuery.data);
	const choosing = $derived(checkoutsFolderQuery.choosing);
	const headingId = $props.id();

	onMount(loadCheckoutsFolderCommand);
</script>

<SettingsSection title="Storage" description="Where your clones and workstreams live on this Mac.">
	<Well title="Storage" headed={false}>
		<div
			class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
		>
			<div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3">
				<div class="min-w-0">
					<h3 id={headingId} class="text-fg-default text-sm font-medium">Checkouts folder</h3>
					<p class="text-fg-tertiary text-xs">Empty folder, same disk. Moves on restart</p>
					{#if checkouts}
						<p class="text-fg-default text-2xs mt-1 font-mono wrap-anywhere">{checkouts.folder}</p>
					{/if}
				</div>
				<Button
					variant="secondary"
					size="sm"
					loading={choosing}
					disabled={!checkouts}
					onclick={chooseCheckoutsFolderCommand}
				>
					Change…
				</Button>
				{#if checkouts?.next}
					<div class="col-span-2 mt-2.5 flex items-center gap-3">
						<p class="text-fg-default min-w-0 flex-1 text-xs">
							Moving to <span class="text-2xs font-mono wrap-anywhere">{checkouts.next}</span>
							on restart
						</p>
						<div class="flex shrink-0 gap-1.5">
							<Button variant="ghost" size="sm" onclick={keepCheckoutsFolderCommand}>
								Stay put
							</Button>
							<Button variant="primary-soft" size="sm" onclick={restartMaliniCommand}>
								Restart now
							</Button>
						</div>
					</div>
				{/if}
				{#if checkouts?.problem}
					<p class="text-error-content col-span-2 mt-2 text-xs" role="alert">
						{PROBLEMS[checkouts.problem.reason](checkouts.problem.folder)}
						{#if checkouts.problem.reason === 'move-failed'}
							They're still in {checkouts.folder}.
						{/if}
					</p>
				{/if}
			</div>
		</div>
	</Well>
</SettingsSection>
