<script lang="ts">
	import { GitHubUserAvatar } from '$shared/repositories/repositories.api';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { updateInitiativeDependencyCommand } from '$lib/initiatives/application/commands/update-initiative-dependency.command';
	import {
		dependencyState,
		isFinished,
		type DependencyState,
		type InitiativeDependency,
		type StandingOf,
	} from '$lib/initiatives/domain/initiative';
	import StatusIcon from './StatusIcon.svelte';
	import TitleEditor from './TitleEditor.svelte';
	import { caretAt } from './title-caret';

	interface Props {
		dependency: InitiativeDependency;
		standingOf: StandingOf;
		here: boolean;
		onstart: () => void;
	}

	let { dependency, standingOf, here, onstart }: Props = $props();

	const STATE_LABEL: Readonly<Record<DependencyState, string>> = {
		todo: 'Not done',
		done: 'Done',
		merged: 'Merged',
		needs: 'Needs you',
		failed: 'Failed',
		running: 'Working',
		idle: 'Idle',
	};

	let renaming: boolean = $state(false);
	let caret: number | null = $state(null);
	let regrab: boolean = $state(false);

	const status = $derived(dependencyState(dependency, standingOf));
	const ticked = $derived(status === 'done');

	function grab(title: HTMLElement): void {
		title.focus();
		regrab = false;
	}

	function rename(at: number | null): void {
		caret = at;
		renaming = true;
	}

	function close(byKey: boolean): void {
		renaming = false;
		regrab = byKey;
	}
</script>

<div
	class="group/dep hover:bg-surface-50 text-2xs relative ml-3 flex h-[26px] items-center gap-2 rounded-md pr-1.5 pl-[30px]"
	role="group"
	aria-label={dependency.title}
>
	<span class="absolute left-[7px] flex size-5 items-center justify-center">
		{#if status === 'todo' || status === 'done'}
			<Tooltip content={ticked ? 'Done. Click to undo' : 'Mark done'} placement="top">
				<IconButton
					variant="ghost"
					size="xs"
					role="checkbox"
					ariaChecked={ticked}
					ariaLabel={dependency.title}
					onclick={() => updateInitiativeDependencyCommand(dependency.id, { done: !ticked })}
				>
					<StatusIcon {status} size={14} />
				</IconButton>
			</Tooltip>
		{:else}
			<StatusIcon {status} size={14} label={STATE_LABEL[status]} />
		{/if}
	</span>
	{#if renaming}
		<TitleEditor
			title={dependency.title}
			label={`Rename ${dependency.title}`}
			{caret}
			inputClass="h-[22px]"
			onsave={(title) => updateInitiativeDependencyCommand(dependency.id, { title })}
			onclose={close}
		/>
	{:else}
		<Button
			bare
			ariaLabel={`Rename ${dependency.title}`}
			class={[
				'focus-visible:ring-border-default/50 flex min-w-0 cursor-text items-center rounded-sm text-left outline-none focus-visible:ring-2',
				isFinished(status) ? 'text-fg-quaternary line-through' : 'text-fg-default',
			]}
			onclick={(event) => rename(caretAt(event, dependency.title))}
			{@attach regrab ? grab : null}
		>
			<span class="min-w-0 truncate"><SensitiveText text={dependency.title} /></span>
		</Button>
		<span class="min-w-0 flex-1"></span>
		{#if here}
			<span class="bg-brand/10 text-brand-foreground text-3xs shrink-0 rounded-sm px-1.5 leading-4">
				This chat
			</span>
		{:else if status === 'needs'}
			<span class="text-brand-foreground text-3xs shrink-0 leading-4">Needs you</span>
		{/if}
		{#if dependency.assignee}
			{#key dependency.assignee}
				<GitHubUserAvatar
					login={dependency.assignee}
					label={`Assigned to ${dependency.assignee}`}
				/>
			{/key}
		{/if}
		{#if status === 'todo'}
			<Tooltip
				content="Start workstream"
				placement="top"
				class="bg-surface-50 absolute right-1 rounded-md opacity-0 group-focus-within/dep:opacity-100 group-hover/dep:opacity-100"
			>
				<IconButton
					variant="ghost"
					size="xs"
					ariaLabel={`Start workstream for ${dependency.title}`}
					class="text-fg-tertiary"
					onclick={onstart}
				>
					<Icon name="send" size={12} />
				</IconButton>
			</Tooltip>
		{/if}
	{/if}
</div>
