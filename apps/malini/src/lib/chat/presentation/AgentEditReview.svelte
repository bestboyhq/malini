<script lang="ts">
	import { untrack } from 'svelte';
	import type { MaliniEditReview } from '$contract/approvals';
	import { Button } from '$hyper-ui/components/button';
	import { MergeEditor } from '$hyper-ui/components/merge-editor';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { decideApprovalCommand } from '$lib/chat/application/commands/decide-approval.command';
	import { editReview, keepsCurrent, reviewedInput } from '$lib/chat/domain/edit-review';
	import { jobName } from '$lib/jobs/jobs.api';
	import type { RenderItem } from './render-state';

	interface Props {
		item: Extract<RenderItem, { kind: 'approval' }>;
		review: MaliniEditReview;
		headingId: string;
		submitting: boolean;
	}

	let { item, review, headingId, submitting }: Props = $props();

	type Decision = 'pending' | 'accepted' | 'rejected';

	const edit = $derived(editReview(review, item.input, jobName));
	let decisions = $state<Record<string, Decision>>({});
	let text = $state(untrack(() => edit.text?.after ?? null));

	const rejected = $derived(
		new Set(Object.keys(decisions).filter((key) => decisions[key] === 'rejected')),
	);

	function labelOf(key: string): string {
		return edit.changes.find((change) => change.key === key)?.label ?? key;
	}

	function decide(key: string, decision: Decision): void {
		decisions = { ...decisions, [key]: decision };
	}

	function reject(): void {
		decideApprovalCommand({
			sessionId: item.sessionId,
			runId: item.runId,
			approvalId: item.approvalId,
			decision: 'deny',
			scope: 'once',
		});
	}

	function save(): void {
		if (keepsCurrent(edit, rejected, text)) {
			reject();
			return;
		}
		decideApprovalCommand({
			sessionId: item.sessionId,
			runId: item.runId,
			approvalId: item.approvalId,
			decision: 'allow',
			scope: 'once',
			updatedInput: reviewedInput(review, edit, rejected, text),
		});
	}
</script>

<div class="flex items-start gap-2.5">
	<span class="grid h-5 w-4 shrink-0 place-items-center" aria-hidden="true">
		<Icon name="shield-alert" class="text-brand-icon" size={15} />
	</span>
	<div class="min-w-0 flex-1">
		<h3 id={headingId} class="text-fg-default text-sm leading-5 font-medium">
			Review Claude’s changes to the {edit.subject}
		</h3>
		<p class="text-fg-tertiary mt-0.5 text-xs leading-4">
			It runs without asking, so each change waits for you. Save keeps every change you do not
			reject, plus your own edits.
		</p>

		{#if edit.changes.length > 0}
			<ul class="mt-2 grid text-xs leading-5" aria-label="Changed settings">
				{#each edit.changes as change (change.key)}
					{@const decision = decisions[change.follows ?? change.key] ?? 'pending'}
					<li
						class="grid min-h-7 grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3"
						aria-label={`${change.label} change`}
						data-decision={decision}
					>
						<span class="text-fg-tertiary">{change.label}</span>
						<span class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
							{#if decision !== 'accepted'}
								<span
									class={[
										'break-words',
										decision === 'rejected' ? 'text-fg-secondary' : 'text-fg-tertiary line-through',
									]}
								>
									<SensitiveText text={change.before} />
								</span>
							{/if}
							{#if decision === 'pending'}
								<Icon name="arrow-right" class="text-fg-tertiary shrink-0 self-center" size={11} />
							{/if}
							{#if decision !== 'rejected'}
								<span class="text-fg-secondary break-words">
									<SensitiveText text={change.after} />
								</span>
							{/if}
						</span>
						<span class="flex items-center gap-1.5">
							{#if change.follows !== null}
								<span class="text-fg-tertiary">Follows {labelOf(change.follows)}</span>
							{:else if decision === 'pending'}
								<Button
									variant="ghost"
									size="sm"
									ariaLabel={`Reject ${change.label}`}
									disabled={submitting}
									onclick={() => decide(change.key, 'rejected')}
								>
									Reject
								</Button>
								<Button
									variant="secondary"
									size="sm"
									bordered
									ariaLabel={`Accept ${change.label}`}
									disabled={submitting}
									onclick={() => decide(change.key, 'accepted')}
								>
									Accept
								</Button>
							{:else}
								<span class="text-fg-tertiary">
									{decision === 'accepted' ? 'Accepted' : 'Rejected'}
								</span>
								<Button
									variant="ghost"
									size="sm"
									ariaLabel={`Undo ${change.label}`}
									disabled={submitting}
									onclick={() => decide(change.key, 'pending')}
								>
									Undo
								</Button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if edit.text && text !== null}
			<MergeEditor
				class="mt-2"
				label={edit.text.label}
				original={edit.text.before}
				bind:value={text}
			/>
		{/if}
	</div>
</div>

<div
	class="mt-3 flex flex-wrap items-center justify-end gap-1.5"
	role="group"
	aria-label="Review decision"
>
	<Button variant="ghost" size="md" class="text-xs" disabled={submitting} onclick={reject}>
		Reject
	</Button>
	<Button variant="primary" size="md" class="text-xs" disabled={submitting} onclick={save}>
		Save
	</Button>
</div>
