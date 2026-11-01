<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		isAgentlessJobBuiltin,
		type JobBoundary,
		type JobChatSight,
		type JobDefinitionRecord,
		type JobEventSight,
	} from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Switch } from '$hyper-ui/components/switch';
	import { Well } from '$hyper-ui/components/well';
	import { ClaudeIcon, GitHubIcon, Icon } from '$hyper-ui/icons';
	import { updateJobSettingsCommand } from '$lib/jobs/application/commands/update-job-settings.command';
	import {
		canLeak,
		jobsBefore,
		publishingThen,
		runsAnAgent,
		seesYourWords,
		triggerChannel,
		WORDLESS_BOUNDARY,
	} from '$lib/jobs/domain/job-boundary';
	import SegmentedPicker from './SegmentedPicker.svelte';
	import SettingRow from './SettingRow.svelte';

	interface Props {
		job: JobDefinitionRecord;
		jobs: readonly JobDefinitionRecord[];
		disabled: boolean;
	}

	let { job, jobs, disabled }: Props = $props();

	const ROWS =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]';
	const EVENT_SIGHTS: readonly Readonly<{ value: JobEventSight; label: string }>[] = [
		{ value: 'facts', label: 'Facts only' },
		{ value: 'full', label: 'In full' },
	];
	const CHAT_SIGHTS: readonly Readonly<{ value: JobChatSight; label: string }>[] = [
		{ value: 'none', label: 'None' },
		{ value: 'starter', label: 'The one that started it' },
		{ value: 'all', label: 'Every chat' },
	];
	const CHATS_HINT: Readonly<Record<JobChatSight, string>> = {
		none: 'It never sees what you typed or what the agent replied.',
		starter: 'What the chat that started it hands it, and that chat’s plan.',
		all: 'Every chat in Malini: what you typed, the replies and the reports.',
	};

	const boundary = $derived(job.boundary);
	const channel = $derived(triggerChannel(job));
	const before = $derived(jobsBefore(job, jobs));
	const publisher = $derived(publishingThen(job, jobs));
	const words = $derived(seesYourWords(job, jobs));
	const leaks = $derived(canLeak(job, jobs));

	function change(next: Partial<JobBoundary>): void {
		updateJobSettingsCommand(job, { boundary: { ...boundary, ...next } });
	}

	function wordsSource(): string {
		if (boundary.chats === 'all') return 'every chat in Malini';
		if (boundary.chats === 'starter') return 'what the chat that started it hands it';
		if (boundary.attachments) return 'your attachments and their transcripts';
		if (boundary.event === 'full' && channel !== null) {
			return 'the whole event that starts it, which can hold your messages';
		}
		const source = before.find((other) => seesYourWords(other, jobs));
		return `the report of ${source?.name ?? 'the job before it'}, which sees your words`;
	}

	function leakRoutes(): string {
		const routes = [
			publisher ? `${publisher.name} publishes what it writes to GitHub` : null,
			boundary.internet ? 'it can reach any site on the internet' : null,
		].filter((route) => route !== null);
		const sentence = routes.join(', and ');
		return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
	}
</script>

{#snippet yourWords()}
	<span
		class="border-warning-content/30 text-warning-content text-3xs rounded-full border-[0.5px] px-1.5 font-medium"
	>
		your words
	</span>
{/snippet}

{#snippet reach(title: string, description: string, icon: Snippet, state: Snippet)}
	<div class="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
		<span class="text-fg-tertiary flex">{@render icon()}</span>
		<div class="min-w-0">
			<h4 class="text-fg-default text-sm font-medium">{title}</h4>
			<p class="text-fg-tertiary text-xs">{description}</p>
		</div>
		<div class="flex items-center">{@render state()}</div>
	</div>
{/snippet}

{#snippet stateText(text: string)}
	<span class="text-fg-tertiary text-xs">{text}</span>
{/snippet}

{#if !runsAnAgent(job)}
	<Well title="What it sees">
		<p class={[ROWS, 'text-fg-secondary px-4 py-3 text-xs leading-5']}>
			{#if job.builtin === 'update-from-main'}
				No agent runs. It merges the base branch into the workstream, so it sees nothing you typed.
			{:else if isAgentlessJobBuiltin(job.builtin)}
				No agent runs. It writes the pull request from the agent’s Commit: and Pull request: lines,
				the changed files and the checks that passed, never from what you typed.
			{:else}
				Malini runs it in one turn with no tools, so what it reads reaches only Claude.
			{/if}
		</p>
	</Well>
{:else}
	{#if leaks}
		<div
			class="border-error-content/20 bg-error text-error-content mx-1.5 flex gap-3 rounded-xl border-[0.5px] px-4 py-3"
			role="alert"
		>
			<Icon name="warning" size={16} class="mt-0.5 shrink-0" />
			<div class="flex min-w-0 flex-col gap-0.5">
				<h3 class="text-sm font-semibold">This job can leak your words</h3>
				<p class="text-error-content/85 text-xs leading-5">
					It sees {wordsSource()}. {leakRoutes()}
				</p>
				<div class="mt-2 flex flex-wrap gap-1.5">
					<Button
						variant="secondary"
						size="sm"
						{disabled}
						onclick={() => change(WORDLESS_BOUNDARY)}
					>
						Stop it seeing your words
					</Button>
					{#if boundary.internet}
						<Button
							variant="secondary"
							size="sm"
							{disabled}
							onclick={() => change({ internet: false })}
						>
							Turn off the internet
						</Button>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<Well title="What it sees">
		{#snippet trailing()}
			<span class="text-fg-tertiary flex items-center gap-1 text-xs">
				<Icon name="lock" size={12} />
				Only you change this. Agents can’t.
			</span>
		{/snippet}
		<div class={ROWS}>
			<SettingRow
				title="Code and changes"
				description="This workstream’s files and its git history."
			>
				<Switch checked disabled ariaLabel="Code and changes" onchange={() => {}} />
			</SettingRow>
			<SettingRow
				title="The event that started it"
				description={channel === null
					? 'Nothing starts it with an event.'
					: 'Facts are ids, statuses and paths. In full, an event can hold your messages.'}
				tag={channel !== null && boundary.event === 'full' ? yourWords : undefined}
			>
				{#if channel === null}
					{@render stateText('None')}
				{:else}
					<SegmentedPicker
						value={boundary.event}
						options={EVENT_SIGHTS}
						label="The event that started it"
						{disabled}
						onchange={(event) => change({ event })}
					/>
				{/if}
			</SettingRow>
			<SettingRow
				title="The job before it"
				description={before.length > 0
					? `The report of ${before.map(({ name }) => name).join(' or ')}.`
					: 'No job runs before it.'}
			>
				<Switch
					checked={boundary.before && before.length > 0}
					disabled={disabled || before.length === 0}
					ariaLabel="The job before it"
					onchange={(checked) => change({ before: checked })}
				/>
			</SettingRow>
			<SettingRow
				title="Your chats"
				description={CHATS_HINT[boundary.chats]}
				tag={boundary.chats === 'none' ? undefined : yourWords}
			>
				<SegmentedPicker
					value={boundary.chats}
					options={CHAT_SIGHTS}
					label="Your chats"
					{disabled}
					onchange={(chats) => change({ chats })}
				/>
			</SettingRow>
			<SettingRow
				title="Your attachments"
				description="Files you attached to chats, and their transcripts."
				tag={boundary.attachments ? yourWords : undefined}
			>
				<Switch
					checked={boundary.attachments}
					{disabled}
					ariaLabel="Your attachments"
					onchange={(attachments) => change({ attachments })}
				/>
			</SettingRow>
		</div>
		{#if !leaks}
			<p class="text-fg-tertiary flex items-center gap-2 px-3 py-1.5 text-xs">
				<Icon name="shield-check" size={14} class="text-success-content shrink-0" />
				{words
					? 'It sees your words, and nothing it does leaves your Mac except through Claude.'
					: 'It never sees your words.'}
			</p>
		{/if}
	</Well>

	<Well title="What it reaches">
		<div class={ROWS}>
			{#snippet claude()}<ClaudeIcon size={16} />{/snippet}
			{#snippet github()}<GitHubIcon size={16} />{/snippet}
			{#snippet globe()}<Icon name="globe" size={16} />{/snippet}
			{#snippet always()}{@render stateText('Always')}{/snippet}
			{#snippet throughThen()}{@render stateText('Through Then')}{/snippet}
			{#snippet throughGh()}{@render stateText('Through gh')}{/snippet}
			{#snippet internet()}
				<Switch
					checked={boundary.internet}
					{disabled}
					ariaLabel="The internet"
					onchange={(checked) => change({ internet: checked })}
				/>
			{/snippet}
			{@render reach(
				'Anthropic',
				'Claude runs its agent and sees what the job sees.',
				claude,
				always,
			)}
			{#if publisher}
				{@render reach(
					'GitHub',
					publisher.builtin === 'merge'
						? 'Then runs Merge, which pushes the branch and merges its pull request.'
						: 'Then runs Open draft, which pushes the branch and opens a draft pull request.',
					github,
					throughThen,
				)}
			{:else if boundary.internet}
				{@render reach(
					'GitHub',
					'Its commands can read and write GitHub with gh.',
					github,
					throughGh,
				)}
			{/if}
			{@render reach(
				'The internet',
				boundary.internet
					? 'Its commands and web tools reach any site.'
					: 'A sandbox blocks every site but Anthropic.',
				globe,
				internet,
			)}
		</div>
	</Well>
{/if}
