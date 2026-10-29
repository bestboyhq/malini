<script lang="ts">
	import { GitHubIcon, Icon } from '@malini/hyper-ui/icons';
	import BeatLabel, { type Beat } from '$lib/BeatLabel.svelte';
	import BrowserMock from '$lib/BrowserMock.svelte';
	import DemoCard from '$lib/DemoCard.svelte';
	import FeatureRow from '$lib/FeatureRow.svelte';
	import Head from '$lib/Head.svelte';
	import Hero from '$lib/Hero.svelte';
	import MergeQueueMock from '$lib/MergeQueueMock.svelte';
	import SectionHeading from '$lib/SectionHeading.svelte';
	import { docHref, DOWNLOAD_URL, GITHUB_URL, SITE_DESCRIPTION } from '$lib/links';

	const doc = (slug: string): string => docHref(`/docs/${slug}`);

	const BEATS = [
		'how',
		'report',
		'compare',
		'browser',
		'variants',
		'ship',
		'merge',
		'open',
		'faq',
		'start',
	] as const;

	const beat = (id: (typeof BEATS)[number], kicker?: string): Beat => ({
		n: BEATS.indexOf(id) + 1,
		total: BEATS.length,
		...(kicker ? { kicker } : {}),
	});

	const pad = (value: number): string => String(value).padStart(2, '0');

	$effect(() => {
		const io = new IntersectionObserver(
			(entries) => {
				let wave = 0;
				for (const { isIntersecting, target } of entries) {
					if (!isIntersecting || !(target instanceof HTMLElement)) continue;
					target.style.setProperty('--i', String(Math.min(wave++, 3)));
					target.dataset.reveal = 'go';
					io.unobserve(target);
				}
			},
			{ rootMargin: `${document.documentElement.scrollHeight}px 0px -10% 0px` },
		);
		const waiting = [...document.querySelectorAll<HTMLElement>('.beat, .rise, .sitemap')].filter(
			(element) => element.getBoundingClientRect().top > innerHeight,
		);
		for (const element of waiting) {
			element.dataset.reveal = 'wait';
			io.observe(element);
		}
		return () => {
			io.disconnect();
			for (const element of waiting) delete element.dataset.reveal;
		};
	});

	const steps = [
		{
			title: 'Start a task',
			body: 'Each task is a workstream with its own git worktree, branch, and chats. Describe what you want and let the agent run.',
		},
		{
			title: 'Press Draft, then Merge',
			body: 'Malini commits, opens the pull request, fixes red checks, addresses reviews, and merges once GitHub allows.',
		},
		{
			title: 'Automate what repeats',
			body: 'When you keep typing the same prompt, Malini offers to save it as a job. Give it a trigger, and it asks you first until you let it run on its own.',
		},
	];

	const trust = [
		{
			icon: 'unlock',
			title: 'Open source',
			body: 'Every line is on GitHub under AGPL-3.0. We can’t take it back.',
		},
		{
			icon: 'lock',
			title: 'No account, no server',
			body: 'Your code leaves your Mac only through the agent you run, Claude Code today, and the GitHub CLI.',
		},
		{
			icon: 'eye',
			title: 'Two calls of its own',
			body: 'Update checks, and anonymous usage data you can turn off. Every big decision is written down.',
		},
	] as const;

	const faqs = [
		{
			question: 'Is Malini free?',
			answer:
				'Yes. Malini is free and open source under AGPL-3.0, with no account and no subscription. Agents run on your own Claude Code today, so they use your own Claude plan.',
		},
		{
			question: 'What do I need?',
			answer:
				'macOS 13 or later on Apple silicon, and git. Malini ships the GitHub CLI, and setup installs Claude Code if you don’t have it.',
		},
		{
			question: 'Where does my code go?',
			answer:
				'To the agent you run and to GitHub through the GitHub CLI. Today the agent is your own Claude Code, so your code goes to Anthropic. There is no Malini account and no Malini server. Malini makes two calls of its own: update checks to GitHub Releases, and anonymous usage data that never includes your code, prompts, paths, or keys. Turn it off under Settings, Privacy.',
		},
		{
			question: 'Can an agent commit or push on its own?',
			answer:
				'No. Agents can’t commit, push, rebase, reset, or run gh pr create. Malini owns the history: it commits, pushes, and opens the pull request when you press Draft or Merge.',
		},
		{
			question: 'Will my agents step on each other’s work?',
			answer:
				'Not in Malini. Each workstream is its own git worktree on its own branch, branched from a private clone of your repository. Dependencies are installed for you from the lockfile.',
		},
		{
			question: 'Which agents and models can I use?',
			answer:
				'Claude Code today, and we want to support more agents. Pick Fable, Opus, Sonnet, or Haiku at any effort from Low to Max, per prompt. Your context window and plan usage are one click from the composer.',
		},
		{
			question: 'Can I extend it?',
			answer:
				'Yes. The panel next to the chat is built from extensions, which add panels, commands, settings, and workflows. The extension API is MIT licensed, so an extension can use any license.',
		},
		{
			question: 'How do updates work?',
			answer:
				'Malini updates itself. Updates download in the background and install when you quit, or right away with Restart to Update.',
		},
	];
</script>

<Head title="Malini: agentic development environment" description={SITE_DESCRIPTION} path="" />

<Hero>
	<p class="lede">
		Run as many agents as you want. Malini handles the chores, so you only review pull requests and
		the gains compound.
	</p>
	<div class="actions">
		<a class="button primary" href={DOWNLOAD_URL}>
			{@render apple()}
			Download for macOS
		</a>
		<a class="button secondary" href={docHref('/docs')}>Read the docs</a>
	</div>
	<p class="fine">macOS 13 or later on Apple silicon · No&nbsp;account · No&nbsp;subscription</p>
</Hero>

<SectionHeading
	id="how"
	beat={beat('how', 'How it works')}
	split
	title="You describe the task."
	quiet="Malini runs the loop."
	description="Each task gets its own agent, branch, and worktree. Malini carries it to a merged pull request."
>
	{#snippet after()}
		<ol class="cells">
			{#each steps as step, index (step.title)}
				<li class="rise">
					<span class="idx" aria-hidden="true">{pad(index + 1)}</span>
					<h3>{step.title}</h3>
					<p>{step.body}</p>
				</li>
			{/each}
		</ol>
	{/snippet}
</SectionHeading>

<FeatureRow
	id="report"
	beat={beat('report', 'Reports')}
	title="No more walls of text."
	body="Every turn ends in a report you read in seconds: what is true now, a picture or recording that shows it, then one line for what changed and one for how the agent checked it."
	href={doc('chat#reports')}
	linkLabel="How reports work"
	checks={['Your turn shows only when it needs you', 'Ship a next step, or note it for later']}
	panel={reportPanel}
/>

<FeatureRow
	id="compare"
	beat={beat('compare', 'Before and after')}
	mirrored
	title="See what changed in seconds."
	body="When the agent changes something you can see, it captures it before and after. Wipe across, flip between, or diff the two, and every changed area gets a number, including the ones it did not mean to change."
	href={doc('chat#before-and-after')}
	linkLabel="How before and after works"
	checks={['Wipe, Flip, or Diff', 'Recordings play side by side on one timeline']}
	panel={comparePanel}
/>

<FeatureRow
	id="browser"
	beat={beat('browser', 'Browser')}
	title="The browser agents enjoy using."
	body="Browser tabs sit next to your files. The agent opens pages, clicks, types, and takes screenshots. The tabs it opens appear beside yours."
	href={doc('agent-tools')}
	linkLabel="What the agent can do"
	checks={['Pick an element and it lands in your prompt', 'The same tabs for you and the agent']}
	panel={browserPanel}
/>

<FeatureRow
	id="variants"
	beat={beat('variants', 'Experiments')}
	mirrored
	title="Experiment first. Build the winner."
	body="Malini takes the scientific approach to building. An open question becomes a small experiment: a few variants side by side, judged by you. The winner gets built, and the rest never touch your code."
	href={doc('chat#variants')}
	linkLabel="How variants work"
	checks={['Pictures, recordings, or live pages', 'None fit? Run another round']}
	panel={variantsPanel}
/>

<SectionHeading
	id="ship"
	beat={beat('ship')}
	title="From idea to shipped."
	quiet="Without babysitting a branch."
	description="A check goes red. Main moves. A reviewer asks for changes. Malini handles each one and tells you when it needs you."
/>

<FeatureRow
	id="merge"
	beat={beat('merge', 'Merge queue')}
	title="Press Merge. Ship the next thing."
	body="Malini pushes, marks the pull request ready, and waits for checks and review. While it waits, it fixes red checks, catches up with main, and answers reviewers."
	href={doc('workstreams')}
	linkLabel="How a merge works"
	checks={['Says Needs you only when it must', 'Merges exactly the commit that passed']}
	panel={mergePanel}
/>

<SectionHeading
	id="open"
	beat={beat('open')}
	title="Open source, so we can’t rug pull you."
	quiet="If we ever go wrong, fork it."
>
	<div class="buttons">
		<a class="button secondary small" href={GITHUB_URL}>
			<GitHubIcon size={14} />
			Star on GitHub
		</a>
		<a class="button secondary small" href="{GITHUB_URL}/tree/main/docs/adr">
			<Icon name="note" size={14} />
			Read the decisions
		</a>
	</div>
	{#snippet after()}
		<ul class="cells">
			{#each trust as item (item.title)}
				<li class="rise">
					<Icon name={item.icon} size={16} />
					<h3>{item.title}</h3>
					<p>{item.body}</p>
				</li>
			{/each}
		</ul>
	{/snippet}
</SectionHeading>

<section id="faq" class="beat" aria-labelledby="faq-title">
	<div class="wrap">
		<BeatLabel {...beat('faq')} />
		<div class="faq">
			<div class="faq-intro rise">
				<h2 id="faq-title">Questions</h2>
				<p>
					Another question? <a href="{GITHUB_URL}/issues">Ask on GitHub</a>
				</p>
			</div>
			<div class="answers rise">
				{#each faqs as faq, index (faq.question)}
					<details>
						<summary>
							<span class="idx" aria-hidden="true">{pad(index + 1)}</span>
							<span class="q">{faq.question}</span>
							<span class="plus" aria-hidden="true"></span>
						</summary>
						<p>{faq.answer}</p>
					</details>
				{/each}
			</div>
		</div>
	</div>
</section>

<section id="start" class="beat closing" aria-labelledby="start-title" data-place="closing">
	<div class="wrap">
		<div class="close">
			<div class="glow" aria-hidden="true"></div>
			<BeatLabel {...beat('start')} />
			<div class="end">
				<div class="rise">
					<h2 id="start-title">Start with the chore you’re tired of.</h2>
					<p class="sub">
						Download Malini, connect Claude Code and GitHub, and let it build the system you wish
						already existed.
					</p>
				</div>
				<div class="close-actions rise">
					<div class="actions">
						<a class="button primary" href={DOWNLOAD_URL}>
							{@render apple()}
							Download for macOS
						</a>
						<a class="button secondary" href={docHref('/docs/install')}>Install guide</a>
					</div>
					<p class="fine">Free and open source · AGPL-3.0</p>
				</div>
			</div>
		</div>
	</div>
</section>

{#snippet apple()}
	<svg
		class="apple"
		viewBox="4 3.1 14.8 18.2"
		width="13"
		height="16"
		aria-hidden="true"
		fill="currentColor"
	>
		<path
			d="M16.37 12.73c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.97.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74s1.78.74 3 .72c1.24-.02 2.02-1.12 2.78-2.23.88-1.28 1.24-2.52 1.26-2.58-.03-.01-2.4-.92-2.42-3.69ZM14.1 5.98c.63-.77 1.06-1.83.94-2.89-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28Z"
		/>
	</svg>
{/snippet}

{#snippet reportPanel()}
	<DemoCard
		workstream="ws-grip-captions"
		title="An agent works on Grip, then reports with a recording of the change"
		play="work"
	/>
{/snippet}

{#snippet comparePanel()}
	<DemoCard
		workstream="ws-tony-hero"
		title="A Malini report with Tony’s hero before and after the change"
		play="sweep"
	/>
{/snippet}

{#snippet browserPanel()}
	<BrowserMock />
{/snippet}

{#snippet mergePanel()}
	<MergeQueueMock />
{/snippet}

{#snippet variantsPanel()}
	<DemoCard
		workstream="ws-og-lead"
		title="A Malini report with three Open Graph image directions to pick from"
		play="cycle"
	/>
{/snippet}

<style>
	.apple {
		translate: 0 -1.5px;
	}

	.lede {
		--rise: 3px;
		--blur: 10px;
		--duration: 1300ms;
		--delay: 150ms;
		max-width: 640px;
		margin-top: 24px;
		color: var(--fg-muted);
		font-size: 19px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.actions {
		--rise: 3px;
		--blur: 8px;
		--duration: 1300ms;
		--delay: 300ms;
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 32px;
	}

	.fine {
		--rise: 3px;
		--blur: 8px;
		--duration: 1300ms;
		--delay: 300ms;
		margin-top: 16px;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
	}

	.cells {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 72px calc(-1 * max(var(--pad), env(safe-area-inset-left))) 0;
		list-style: none;
	}

	.cells li {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 40px var(--pad);
		border-top: 1px solid var(--frame);
	}

	.cells li + li {
		border-left: 1px solid var(--frame);
	}

	.idx {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 24px;
		font-variant-numeric: tabular-nums;
	}

	.cells .idx {
		margin-bottom: 4px;
	}

	.cells li > :global(svg) {
		margin: 4px 0 8px;
		color: var(--fg-muted);
	}

	.cells h3 {
		font-size: 17px;
		font-weight: 550;
		line-height: 1.4;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}

	.cells p {
		color: var(--fg-muted);
		font-size: 15px;
		line-height: 1.6;
		text-wrap: pretty;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
		margin-top: 12px;
	}

	.faq {
		display: grid;
		grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
		gap: 24px 64px;
		align-items: start;
	}

	.faq-intro {
		position: sticky;
		top: calc(var(--bar-h) + 32px);
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	h2 {
		font-size: clamp(30px, 3.4vw, 40px);
		font-weight: 550;
		line-height: 1.1;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.faq-intro p,
	.sub {
		max-width: 560px;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.faq-intro a {
		color: var(--fg-default);
		font-weight: 500;
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-decoration-thickness: 1.5px;
		text-underline-offset: 3px;
		white-space: nowrap;
	}

	details + details {
		border-top: 1px solid var(--border-default);
	}

	summary {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) 16px;
		gap: 16px;
		align-items: center;
		min-height: 64px;
		padding: 16px 0;
		list-style: none;
		cursor: pointer;
		-webkit-user-select: none;
		user-select: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.q {
		font-size: 16px;
		font-weight: 500;
		line-height: 24px;
		text-wrap: pretty;
	}

	.plus {
		position: relative;
		justify-self: end;
		width: 12px;
		height: 12px;
	}

	.plus::before,
	.plus::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		width: 12px;
		height: 1.5px;
		margin-top: -0.75px;
		border-radius: 1px;
		background: var(--fg-muted);
		transition: rotate 200ms var(--ease);
	}

	.plus::after {
		rotate: 90deg;
	}

	details[open] .plus::after {
		rotate: 0deg;
	}

	summary:active .q {
		color: var(--fg-secondary);
	}

	details p {
		max-width: 600px;
		padding: 0 32px 22px 40px;
		color: var(--fg-muted);
		font-size: 16px;
		line-height: 24px;
		text-wrap: pretty;
	}

	details::details-content {
		height: 0;
		overflow: clip;
	}

	details[open]::details-content {
		height: auto;
	}

	@media (prefers-reduced-motion: no-preference) {
		details::details-content {
			interpolate-size: allow-keywords;
			transition:
				height 200ms var(--ease),
				content-visibility 200ms allow-discrete;
		}
	}

	.close {
		position: relative;
		padding: 56px 64px 64px;
	}

	.glow {
		position: absolute;
		z-index: -1;
		inset: 10% 20% 0 10%;
		background:
			radial-gradient(closest-side, #1957fa, transparent) 0 30% / 55% 80% no-repeat,
			radial-gradient(closest-side, #d94f46, transparent) 50% 60% / 50% 70% no-repeat,
			radial-gradient(closest-side, #fb8600, transparent) 100% 40% / 45% 70% no-repeat;
		filter: blur(48px);
		opacity: 0.14;
		pointer-events: none;
	}

	.end {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 32px 48px;
	}

	.end > div:first-child {
		flex: 1 1 520px;
		max-width: 780px;
	}

	.end .sub {
		margin-top: 20px;
	}

	.close-actions .actions {
		margin-top: 0;
	}

	@media (hover: hover) and (pointer: fine) {
		summary:hover .plus::before,
		summary:hover .plus::after {
			background: var(--fg-default);
		}

		.faq-intro a:hover {
			text-decoration-color: var(--fg-default);
		}
	}

	@media (max-width: 1023px) {
		.cells {
			grid-template-columns: minmax(0, 1fr);
			margin-top: 48px;
		}

		.cells li {
			padding-block: 32px;
		}

		.cells li + li {
			border-left: 0;
		}
	}

	@media (max-width: 859px) {
		.lede,
		.faq-intro p,
		.sub {
			font-size: 17px;
		}

		.faq {
			grid-template-columns: minmax(0, 1fr);
			gap: 32px;
		}

		.faq-intro {
			position: static;
		}

		.close {
			padding: 44px 28px 48px;
		}

		.end > div:first-child {
			flex-basis: auto;
		}
	}

	@media (max-width: 559px) {
		summary {
			grid-template-columns: minmax(0, 1fr) 16px;
		}

		summary .idx {
			display: none;
		}

		details p {
			padding: 0 24px 20px 0;
		}

		.close {
			margin-inline: -12px;
			padding: 40px 12px 44px;
		}
	}
</style>
