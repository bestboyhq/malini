<script lang="ts">
	import type { BestboyProject } from '$contract/stats';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { Switch } from '$hyper-ui/components/switch';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { RepositoryAvatar } from '$shared/repositories/repositories.api';
	import { openBestboyPageCommand } from '$lib/stats/application/commands/open-bestboy-page.command';
	import { setProjectCommand } from '$lib/stats/application/commands/set-project.command';
	import { projectLink } from '$lib/stats/domain/projects';
	import { PROJECT_STATE_LABELS } from './profile-copy';
	import { plural } from './stats-format';

	interface Props {
		project: BestboyProject;
		signedIn: boolean;
	}

	let { project, signedIn }: Props = $props();

	const savedLink = $derived(project.link);
	let draft = $derived(savedLink);
	const checked = $derived(projectLink(draft));
	const typedProblem = $derived(draft.trim() === '' ? null : checked.problem);
	const problem = $derived(typedProblem ?? project.problem);
	const state = $derived(project.on ? project.state : null);
	const nameId = $props.id();

	function onInput(event: Event): void {
		if (event.currentTarget instanceof HTMLInputElement) draft = event.currentTarget.value;
	}

	function onCommit(): void {
		if (draft.trim() === savedLink || checked.link === savedLink) return;
		setProjectCommand({ repositoryId: project.repositoryId, on: project.on, link: draft });
	}

	function onSwitch(on: boolean): void {
		setProjectCommand({ repositoryId: project.repositoryId, on, link: draft });
	}
</script>

<li aria-labelledby={nameId}>
	<div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 pr-3 pl-3.5">
		<RepositoryAvatar fullName={project.fullName} size={28} />
		<div class="min-w-0">
			<div class="flex min-w-0 items-center gap-1.5">
				<h4 id={nameId} class="text-fg-default truncate text-sm font-medium">
					{project.fullName}
				</h4>
				{#if project.private}
					<Badge class="shrink-0">Private</Badge>
				{/if}
			</div>
			<p class="text-fg-tertiary truncate text-xs">
				{plural(project.runs, 'run', 'runs')} · {plural(project.days, 'day', 'days')}
			</p>
		</div>
		<Switch
			checked={project.on}
			disabled={!signedIn || (!project.on && checked.link === null)}
			ariaLabel={`Put ${project.fullName} on Bestboy`}
			onchange={onSwitch}
		/>
	</div>
	<div class="flex items-center gap-3 pr-3 pb-2.5 pl-13.5">
		<TextInput
			value={draft}
			size="xs"
			placeholder="https://"
			autocomplete="off"
			disabled={!signedIn}
			invalid={problem !== null}
			ariaLabel={`Link for ${project.fullName}`}
			class="min-w-0 flex-1"
			inputClass="font-mono text-xs"
			oninput={onInput}
			onchange={onCommit}
		/>
		{#if state}
			<p class="text-fg-secondary flex shrink-0 items-center gap-1 text-xs">
				{PROJECT_STATE_LABELS[state]}
				{#if project.url}
					{@const url = project.url}
					<span aria-hidden="true">·</span>
					<Button
						bare
						class="text-fg-secondary hover:text-fg-default cursor-pointer underline underline-offset-2"
						onclick={() => openBestboyPageCommand(url)}
					>
						{state === 'live' ? 'Open its page' : 'Open it'}
					</Button>
				{/if}
			</p>
		{:else if draft.trim() === ''}
			<p class="text-fg-tertiary shrink-0 text-xs">Needs its link</p>
		{/if}
	</div>
	{#if problem}
		<p class="text-error-content pr-3 pb-2.5 pl-13.5 text-xs" role="alert">{problem}</p>
	{/if}
</li>
