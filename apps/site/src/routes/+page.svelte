<script lang="ts">
	import { asset } from '$app/paths';
	import hero from '../../../../.github/readme/hero.webp';
	import { GitHubIcon, Icon } from '@malini/hyper-ui/icons';
	import Head from '$lib/Head.svelte';
	import BrowserMock from '$lib/BrowserMock.svelte';
	import FeatureRow from '$lib/FeatureRow.svelte';
	import MergeQueueMock from '$lib/MergeQueueMock.svelte';
	import QueueMock from '$lib/QueueMock.svelte';
	import RoutineMock from '$lib/RoutineMock.svelte';
	import Section from '$lib/Section.svelte';
	import SectionHeading from '$lib/SectionHeading.svelte';
	import { StageLight, StagePanel } from '$lib/stage/stage.api';
	import TerminalMock from '$lib/TerminalMock.svelte';
	import { docHref, DOWNLOAD_URL, GITHUB_URL, SITE_DESCRIPTION } from '$lib/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let heroPanel = $state<HTMLElement>();
	let heroLit = $state(false);
	let ctaPanel = $state<HTMLElement>();
	let ctaLit = $state(false);

	const doc = (slug: string) => docHref(`/docs/${slug}`);

	const steps = [
		{
			title: 'Start a task',
			body: 'Each task is a workstream: its own git worktree, its own branch, its own chats. Start one or start a hundred.',
		},
		{
			title: 'Keep it moving',
			body: 'Queue prompts, run jobs, plan first if you like. Agents write code, and Malini owns git.',
		},
		{
			title: 'Press Draft, then Merge',
			body: 'Malini commits, opens the pull request, fixes red checks, addresses reviews, and merges once GitHub allows.',
		},
	];

	const trust = [
		{
			icon: 'unlock',
			title: 'Open source',
			body: 'The code is public under AGPL-3.0. We can’t take it back, and if we ever go wrong, you can fork it.',
		},
		{
			icon: 'lock',
			title: 'No account, no server',
			body: 'Your code leaves your Mac only through your own Claude Code and the GitHub CLI.',
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
				'Yes. Malini is free and open source under AGPL-3.0, with no account and no subscription. The agents run on your own Claude Code, so their usage counts against your own Claude plan.',
		},
		{
			question: 'What do I need?',
			answer:
				'macOS 13 or later on Apple silicon, and git. Malini ships the GitHub CLI, and setup installs Claude Code if you don’t have it.',
		},
		{
			question: 'Does my code go through a Malini server?',
			answer:
				'No. There is no Malini account and no Malini server. Your code goes to Anthropic through your own Claude Code, and to GitHub through the GitHub CLI. Malini makes two calls of its own: update checks to GitHub Releases, and anonymous usage data that you can turn off under Settings, Privacy.',
		},
		{
			question: 'Can an agent commit or push on its own?',
			answer:
				'No. The agent bridge refuses commit, push, rebase, reset, and gh pr create. Malini owns the history: it commits, pushes, and opens the pull request when you press Draft or Merge.',
		},
		{
			question: 'Won’t parallel agents clobber each other?',
			answer:
				'Every workstream is its own git worktree on its own branch, branched from a private clone of the repository, with dependencies installed from the lockfile.',
		},
		{
			question: 'Which models can I use?',
			answer:
				'Fable, Opus, Sonnet, or Haiku, from Low to Max effort, picked per prompt. The composer shows your context window and your plan usage.',
		},
		{
			question: 'Can I extend it?',
			answer:
				'Yes. The inspector, its panels, commands, settings, and workflows come from extensions. The extension API is MIT licensed, so an extension can use any license.',
		},
		{
			question: 'How do updates work?',
			answer:
				'Updates download in the background and install when you quit, or right away with Restart to Update.',
		},
	];

	const firstRun = [
		{ title: 'Download Malini', body: 'Drag it to Applications and open it.' },
		{
			title: 'Connect Claude Code and GitHub',
			body: 'Install and Sign in for Claude Code, and a one-time code in your browser for GitHub.',
		},
		{
			title: 'Add a repository',
			body: 'Clone one or open a folder. Your first workstream is ready.',
		},
	];
</script>

<Head title="Malini - many Claude Code agents, one window" description={SITE_DESCRIPTION} path="" />

<section class="hero" aria-labelledby="hero-title">
	<div class="frame">
		<header class="intro">
			<a class="eyebrow" href={GITHUB_URL}>
				<GitHubIcon size={14} />
				<span>Free and open source, for the Mac</span>
				<Icon name="arrow-right" size={12} />
			</a>
			<h1 id="hero-title">
				<span>You had one job.</span>
				<span class="quiet">Now you have plenty.</span>
			</h1>
			<p class="lede">
				Many Claude Code agents, one window, one merged pull request each. Every task gets its own
				git worktree and its own agent, and Malini takes it from prompt to merged.
			</p>
			<div class="actions">
				<a class="button primary" href={DOWNLOAD_URL}>
					{@render apple()}
					Download for macOS
				</a>
				<a class="button secondary" href={docHref('/docs')}>Read the docs</a>
			</div>
			<p class="fine">macOS 13 or later on Apple silicon · No account · No subscription</p>
		</header>
	</div>
	<div class="showcase">
		<div class="spot">
			<StageLight preset="hero" caster={heroPanel} bind:lit={heroLit} />
		</div>
		<div class="frame">
			<div class="window">
				<StagePanel lit={heroLit} bind:element={heroPanel}>
					<img
						class="shot"
						src={hero}
						width="2560"
						height="1600"
						alt="Malini with three repositories in the sidebar, an agent's finished run in the chat, and the changed files beside it"
						fetchpriority="high"
					/>
				</StagePanel>
			</div>
		</div>
	</div>
</section>

<SectionHeading
	id="how"
	title="One task. One worktree."
	quiet="One merged pull request."
	description="Malini gives every task its own agent and its own branch, so ten things can move at once without stepping on each other."
/>

<Section class="cells">
	<ol class="steps">
		{#each steps as step, index (step.title)}
			<li>
				<span class="number">{index + 1}</span>
				<h3>{step.title}</h3>
				<p>{step.body}</p>
			</li>
		{/each}
	</ol>
</Section>

<div class="gap band"><div class="frame"><div class="rail"></div></div></div>

<FeatureRow
	id="chat"
	title="A chat that keeps up"
	body="Enter queues a prompt after the current run, Cmd+Enter steers it now, and background commands keep running. Edit, reorder, or delete what is waiting."
	href={doc('chat')}
	linkLabel="About the chat"
	checks={['Plan mode, model and effort per prompt', 'Undo any run, or fork it to a new chat']}
	panel={chatPanel}
/>

<div class="gap band"><div class="frame"><div class="rail"></div></div></div>

<FeatureRow
	id="browser"
	mirrored
	title="A browser the agent can drive"
	body="Browser tabs sit next to your files. The agent opens, types, clicks, and screenshots, and the tabs it opens show up beside yours."
	href={doc('agent-tools')}
	linkLabel="The agent's tools"
	checks={['Pick an element and it lands in your prompt', 'The same tabs for you and the agent']}
	panel={browserPanel}
/>

<SectionHeading
	id="ship"
	title="From prompt to merged."
	quiet="Without babysitting a branch."
	description="Agents write the code. Malini owns git: it commits, opens the pull request, and keeps it moving until GitHub merges it."
/>

<FeatureRow
	id="merge"
	title="A merge queue that does the chores"
	body="Press Merge and Malini pushes, marks the pull request ready, updates from main, and waits for checks and review. While it waits, it runs Fix checks, Update from main, and Address review."
	href={doc('workstreams')}
	linkLabel="How workstreams ship"
	checks={['Says Needs you only when it must', 'Merges exactly the commit that passed']}
	panel={mergePanel}
/>

<SectionHeading
	id="outcomes"
	title="Outcomes, not skills."
	quiet="Ask for them by name."
	description="A job is agent work you reuse: instructions, a model, an effort, and only the skills it needs. Routines run jobs when something happens."
/>

<FeatureRow
	id="routines"
	mirrored
	title="Routines that earn your trust"
	body="Ask the agent for a routine and it writes the trigger from Malini's own events. Every save waits for your approval, and a new routine starts as a draft."
	href={doc('routines')}
	linkLabel="How routines work"
	checks={['Draft, then candidate, then unattended', 'Triggers on any event Malini emits']}
	panel={routinePanel}
/>

<SectionHeading
	id="open"
	title="Open source, so we can’t rug pull you."
	quiet="Transparent, all the way down."
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
</SectionHeading>

<Section class="cells">
	<ul class="trust">
		{#each trust as item (item.title)}
			<li>
				<Icon name={item.icon} size={16} />
				<h3>{item.title}</h3>
				<p>{item.body}</p>
			</li>
		{/each}
	</ul>
</Section>

<div class="gap band"><div class="frame"><div class="rail"></div></div></div>

<FeatureRow
	id="docs"
	title="Docs for people and agents"
	body="Every docs page is plain markdown at its URL plus .md. llms.txt lists them all, and every event Malini emits is documented with its payload."
	href={docHref('/docs')}
	linkLabel="Read the docs"
	checks={[
		'llms.txt and llms-full.txt, built from the docs',
		'The events reference is generated from the code',
	]}
	header={terminalHeader}
	panel={terminalPanel}
/>

<Section id="faq" label="faq-title">
	<div class="faq">
		<div class="faq-intro">
			<h2 id="faq-title">Frequently asked questions</h2>
			<p>
				Have a different question? <a href="{GITHUB_URL}/issues">Ask on GitHub</a>
			</p>
		</div>
		<div class="answers">
			{#each faqs as faq (faq.question)}
				<details>
					<summary>
						{faq.question}
						<svg
							viewBox="0 0 16 16"
							width="16"
							height="16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<path d="M3.25 8h9.5" />
							<path class="stem" d="M8 3.25v9.5" />
						</svg>
					</summary>
					<p>{faq.answer}</p>
				</details>
			{/each}
		</div>
	</div>
</Section>

<Section label="cta-title">
	<div class="cta">
		<div class="cta-copy">
			<h2 id="cta-title">Give every task its own agent.</h2>
			<p>Download Malini, connect Claude Code and GitHub, and add a repository.</p>
			<div class="actions">
				<a class="button primary" href={DOWNLOAD_URL}>
					{@render apple()}
					Download for macOS
				</a>
				<a class="button secondary" href={docHref('/docs/install')}>Install guide</a>
			</div>
			<p class="fine">Free and open source · AGPL-3.0</p>
		</div>
		<div class="cta-stage">
			<StageLight preset="top-left" caster={ctaPanel} bind:lit={ctaLit} />
			<div class={['cta-panel', { lit: ctaLit }]} bind:this={ctaPanel}>
				<div class="cta-head">
					<img src={asset('/malini.png')} width="28" height="28" alt="" />
					Your first workstream
				</div>
				<ol>
					{#each firstRun as item, index (item.title)}
						<li>
							<span class="day">
								<span>Step</span>
								<span>{index + 1}</span>
							</span>
							<span>
								<strong>{item.title}</strong>
								<span>{item.body}</span>
							</span>
						</li>
					{/each}
				</ol>
			</div>
		</div>
	</div>
</Section>

<div class="gap"><div class="frame"><div class="rail"></div></div></div>

{#snippet apple()}
	<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
		<path
			d="M16.37 12.73c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.97.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74s1.78.74 3 .72c1.24-.02 2.02-1.12 2.78-2.23.88-1.28 1.24-2.52 1.26-2.58-.03-.01-2.4-.92-2.42-3.69ZM14.1 5.98c.63-.77 1.06-1.83.94-2.89-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28Z"
		/>
	</svg>
{/snippet}

{#snippet chatPanel()}
	<QueueMock />
{/snippet}

{#snippet browserPanel()}
	<BrowserMock />
{/snippet}

{#snippet mergePanel()}
	<MergeQueueMock />
{/snippet}

{#snippet routinePanel()}
	<RoutineMock />
{/snippet}

{#snippet terminalHeader()}
	<span class="dots" aria-hidden="true">
		<span></span>
		<span></span>
		<span></span>
	</span>
	<span class="terminal-title">Terminal</span>
{/snippet}

{#snippet terminalPanel()}
	<TerminalMock llms={data.llms} doc={data.doc} />
{/snippet}

<style>
	.hero {
		padding-bottom: 64px;
		border-bottom: 1px solid var(--line);
	}

	.intro {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 72px var(--pad) 8px;
	}

	.intro > :global(*) {
		animation: enter 1.3s var(--ease-out-quart) backwards;
	}

	.intro > :global(:nth-child(1)) {
		animation-delay: 200ms;
	}

	.intro > :global(:nth-child(3)) {
		animation-delay: 120ms;
	}

	.intro > :global(:nth-child(4)) {
		animation-delay: 240ms;
	}

	.intro > :global(:nth-child(5)) {
		animation-delay: 320ms;
	}

	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 12px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--fg-secondary);
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
		transition:
			box-shadow 150ms ease,
			color 150ms ease;
	}

	.eyebrow:hover {
		box-shadow: inset 0 0 0 1px var(--line-strong);
		color: var(--fg);
	}

	h1 {
		margin-top: 24px;
		font-size: clamp(38px, 6vw, 68px);
		font-weight: 550;
		line-height: 1.02;
		letter-spacing: -0.04em;
	}

	h1 span {
		white-space: nowrap;
	}

	.quiet {
		color: var(--fg-faint);
	}

	.lede {
		max-width: 640px;
		margin-top: 24px;
		color: var(--fg-muted);
		font-size: 19px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 32px;
	}

	.fine {
		margin-top: 16px;
		color: var(--fg-muted);
		font-size: 13px;
	}

	.showcase {
		position: relative;
		padding: 48px 0 56px;
		animation: enter 1.6s var(--ease-out-quart) 380ms backwards;
	}

	.spot {
		position: absolute;
		inset: 0 12px;
		max-width: 1920px;
		margin: 0 auto;
		overflow: hidden;
		border-radius: 18px;
	}

	.window {
		position: relative;
		padding: 0 var(--pad);
	}

	.shot {
		display: block;
		width: 100%;
		height: auto;
	}

	.gap .rail {
		height: 64px;
	}

	:global(.cells) {
		overflow: hidden;
	}

	.steps,
	.trust {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		list-style: none;
	}

	.steps li,
	.trust li {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 40px var(--pad);
	}

	.steps li + li,
	.trust li + li {
		border-left: 1px solid var(--line);
	}

	.number {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		margin-bottom: 8px;
		border-radius: 8px;
		box-shadow: inset 0 0 0 1px var(--line-strong);
		color: var(--fg-secondary);
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.trust li :global(svg) {
		margin-bottom: 8px;
		color: var(--fg-muted);
	}

	.steps h3,
	.trust h3 {
		font-size: 17px;
		font-weight: 550;
		letter-spacing: -0.01em;
	}

	.steps p,
	.trust p {
		color: var(--fg-muted);
		font-size: 15px;
		line-height: 1.6;
		text-wrap: pretty;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
		margin-top: 32px;
	}

	.terminal-title {
		color: var(--app-fg-3);
	}

	.dots {
		display: inline-flex;
		gap: 6px;
	}

	.dots span {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--app-line-strong);
	}

	.faq {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 48px;
		padding: 112px var(--pad);
	}

	.faq-intro {
		display: flex;
		grid-column: span 2;
		flex-direction: column;
		gap: 12px;
	}

	.answers {
		grid-column: span 3;
	}

	.faq h2 {
		font-size: 36px;
		font-weight: 550;
		line-height: 40px;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.faq-intro p {
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 28px;
		text-wrap: pretty;
	}

	.faq-intro a {
		color: var(--fg);
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}

	.faq-intro a:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	details + details {
		border-top: 1px solid var(--line);
	}

	summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		padding: 20px 0;
		font-size: 16px;
		font-weight: 500;
		line-height: 24px;
		list-style: none;
		cursor: pointer;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary svg {
		flex: none;
		margin-right: 4px;
		color: var(--fg-muted);
		transition: color 150ms ease;
	}

	summary:hover svg,
	details[open] summary svg {
		color: var(--fg);
	}

	.stem {
		transform-box: fill-box;
		transform-origin: center;
	}

	details[open] .stem {
		rotate: 90deg;
	}

	details p {
		padding: 0 40px 16px 0;
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
		.stem {
			transition: rotate 200ms var(--ease-out-quart);
		}

		details::details-content {
			interpolate-size: allow-keywords;
			transition:
				height 200ms ease,
				content-visibility 200ms allow-discrete;
		}
	}

	.cta h2 {
		text-wrap: balance;
		font-size: clamp(30px, 3.4vw, 40px);
		font-weight: 550;
		line-height: 1.1;
		letter-spacing: -0.03em;
	}

	.cta {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.cta-copy {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		padding: 80px var(--pad);
		border-right: 1px solid var(--line);
	}

	.cta-copy > p:first-of-type {
		max-width: 440px;
		margin-top: 16px;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1.55;
	}

	.cta-stage {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 56px 48px;
	}

	.cta-panel {
		position: relative;
		width: 100%;
		max-width: 480px;
		overflow: hidden;
		border-radius: 14px;
		background: var(--app-panel);
		box-shadow:
			var(--app-shadow),
			0 0 0 1px var(--app-line);
		color: var(--app-fg);
	}

	.cta-panel.lit {
		box-shadow: 0 0 0 1px var(--app-line);
	}

	.cta-head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 20px 24px;
		border-bottom: 1px solid var(--app-line);
		font-size: 17px;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	.cta-head img {
		border-radius: 7px;
	}

	.cta-panel ol {
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 24px;
		list-style: none;
	}

	.cta-panel li {
		display: flex;
		gap: 16px;
		font-size: 14px;
	}

	.cta-panel li > span:last-child {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cta-panel strong {
		font-weight: 500;
	}

	.cta-panel li > span:last-child > span {
		color: var(--app-fg-3);
		line-height: 1.55;
	}

	.day {
		align-self: flex-start;
		display: flex;
		flex: none;
		flex-direction: column;
		width: 44px;
		overflow: hidden;
		border-radius: 7px;
		background: var(--app-root);
		box-shadow: inset 0 0 0 1px var(--app-line-strong);
		text-align: center;
	}

	.day span:first-child {
		padding: 2px 0;
		background: var(--app-raised);
		color: var(--app-fg-2);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.day span:last-child {
		padding: 3px 0 4px;
		font-family: var(--mono);
		font-size: 15px;
	}

	@keyframes enter {
		from {
			opacity: 0;
			translate: 0 6px;
			filter: blur(8px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.intro > :global(*),
		.showcase {
			animation: fade 400ms ease backwards;
		}
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	@media (max-width: 1023px) {
		.intro {
			padding-top: 56px;
		}

		.steps,
		.trust {
			grid-template-columns: minmax(0, 1fr);
		}

		.steps li + li,
		.trust li + li {
			border-top: 1px solid var(--line);
			border-left: 0;
		}

		.faq,
		.cta {
			grid-template-columns: minmax(0, 1fr);
		}

		.faq {
			gap: 40px;
			padding: 80px var(--pad);
		}

		.faq-intro,
		.answers {
			grid-column: auto;
		}

		.cta-copy {
			padding: 64px var(--pad);
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}

		.spot {
			inset: 0;
			border-radius: 0;
		}
	}

	@media (max-width: 640px) {
		.faq h2 {
			font-size: 30px;
			line-height: 36px;
		}

		h1 span {
			display: block;
			white-space: normal;
		}

		.lede {
			font-size: 17px;
		}

		.cta-stage {
			padding: 32px 12px;
		}
	}
</style>
