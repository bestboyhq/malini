<script lang="ts">
	import hero from '../../../../.github/readme/hero.webp';
	import { GitHubIcon, Icon } from '@malini/hyper-ui/icons';
	import Arrow from '$lib/Arrow.svelte';
	import BeatLabel, { type Beat } from '$lib/BeatLabel.svelte';
	import BrowserMock from '$lib/BrowserMock.svelte';
	import FeatureRow from '$lib/FeatureRow.svelte';
	import Head from '$lib/Head.svelte';
	import MergeQueueMock from '$lib/MergeQueueMock.svelte';
	import QueueMock from '$lib/QueueMock.svelte';
	import RoutineMock from '$lib/RoutineMock.svelte';
	import SectionHeading from '$lib/SectionHeading.svelte';
	import Glow, { type Layer } from '$lib/Glow.svelte';
	import TerminalMock from '$lib/TerminalMock.svelte';
	import { docHref, DOWNLOAD_URL, GITHUB_URL, SITE_DESCRIPTION } from '$lib/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const HORIZON: readonly Layer[] = [{ box: [0, -0.46, 1, 0.9], peak: [0.42, 0.86], start: 0.18 }];

	const doc = (slug: string): string => docHref(`/docs/${slug}`);

	const BEATS = [
		'how',
		'chat',
		'browser',
		'ship',
		'merge',
		'outcomes',
		'routines',
		'open',
		'docs',
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
			body: 'Each task is a workstream with its own git worktree, branch, and chats. Start one or a hundred.',
		},
		{
			title: 'Keep it moving',
			body: 'Queue prompts, plan first if you like, and start the next task. Agents write the code. Malini owns git.',
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
			body: 'Every line is on GitHub under AGPL-3.0. We can’t take it back.',
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
				'Yes. Malini is free and open source under AGPL-3.0, with no account and no subscription. The agents run on your own Claude Code, so they use your own Claude plan.',
		},
		{
			question: 'What do I need?',
			answer:
				'macOS 13 or later on Apple silicon, and git. Malini ships the GitHub CLI, and setup installs Claude Code if you don’t have it.',
		},
		{
			question: 'Where does my code go?',
			answer:
				'To Anthropic through your own Claude Code, and to GitHub through the GitHub CLI. There is no Malini account and no Malini server. Malini makes two calls of its own: update checks to GitHub Releases, and anonymous usage data that never includes your code, prompts, paths, or keys. Turn it off under Settings, Privacy.',
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
			question: 'Which models can I use?',
			answer:
				'Fable, Opus, Sonnet, or Haiku, at any effort from Low to Max, picked per prompt. Your context window and plan usage are one click from the composer.',
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

<Head title="Malini: many Claude Code agents, one window" description={SITE_DESCRIPTION} path="" />

<div class="progress" aria-hidden="true"></div>

<section class="hero" aria-labelledby="hero-title">
	<div class="wrap intro">
		<a class="eyebrow" href={GITHUB_URL}>
			<GitHubIcon size={14} />
			<span>Free and open source, for the Mac</span>
			<Arrow class="ahead" />
		</a>
		<h1 id="hero-title">
			<span>You had one job.</span>
			<span class="quiet">Now you have plenty.</span>
		</h1>
		<p class="lede">
			Twenty agents you have to watch isn’t leverage. Malini helps you build systems that run the
			work you repeat, so you pull ahead of everyone still babysitting theirs.
		</p>
		<div class="actions">
			<a class="button primary" href={DOWNLOAD_URL}>
				{@render apple()}
				Download for macOS
			</a>
			<a class="button secondary" href={docHref('/docs')}>Read the docs</a>
		</div>
		<p class="fine">macOS 13 or later on Apple silicon · No&nbsp;account · No&nbsp;subscription</p>
	</div>
	<div class="plate beat">
		<div class="horizon" aria-hidden="true"></div>
		<div class="gl" aria-hidden="true">
			<Glow layers={HORIZON} opacity={0.85} />
		</div>
		<div class="wrap window">
			<img
				class="shot"
				src={hero}
				width="2560"
				height="1600"
				alt="The Malini window: six workstreams across malini, grip, and tony in the sidebar, a finished chat, and Draft and Merge above 2 changed files"
				fetchpriority="high"
			/>
		</div>
	</div>
</section>

<SectionHeading
	id="how"
	beat={beat('how', 'How it works')}
	split
	title="One task. One worktree."
	quiet="One merged pull request."
	description="Every task gets its own agent and its own branch. Ten can run at once, and none step on another."
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
	id="chat"
	beat={beat('chat', 'Chat')}
	title="Keep typing while it works."
	body="Enter queues a prompt after the current run. Cmd+Enter steers it now, and background commands keep running. Edit, reorder, or delete what is waiting."
	href={doc('chat')}
	linkLabel="How the chat works"
	checks={['A model and an effort for every prompt', 'Undo any run, or fork it to a new chat']}
	panel={chatPanel}
/>

<FeatureRow
	id="browser"
	beat={beat('browser', 'Browser')}
	mirrored
	title="Give the agent a browser."
	body="Browser tabs sit next to your files. The agent opens pages, clicks, types, and takes screenshots. The tabs it opens appear beside yours."
	href={doc('agent-tools')}
	linkLabel="What the agent can do"
	checks={['Pick an element and it lands in your prompt', 'The same tabs for you and the agent']}
	panel={browserPanel}
/>

<SectionHeading
	id="ship"
	beat={beat('ship')}
	title="From prompt to merged."
	quiet="Without babysitting a branch."
	description="A check goes red. Main moves. A reviewer asks for changes. Malini handles each one and tells you when it needs you."
/>

<FeatureRow
	id="merge"
	beat={beat('merge', 'Merge queue')}
	title="Press Merge. Do something else."
	body="Malini pushes, marks the pull request ready, and waits for checks and review. While it waits, it fixes red checks, catches up with main, and answers reviewers."
	href={doc('workstreams')}
	linkLabel="How a merge works"
	checks={['Says Needs you only when it must', 'Merges exactly the commit that passed']}
	panel={mergePanel}
/>

<SectionHeading
	id="outcomes"
	beat={beat('outcomes')}
	title="You never wanted skills."
	quiet="You wanted green checks."
	description="A job is agent work you ask for by name, like Fix checks or Update from main. Routines run jobs when something happens."
/>

<FeatureRow
	id="routines"
	beat={beat('routines', 'Routines')}
	mirrored
	title="Automate it once you trust it."
	body="Tell the agent what to run when a pull request merges, and it writes the routine. You approve every save. A new routine starts as a draft."
	href={doc('routines')}
	linkLabel="How routines work"
	checks={['Draft, then candidate, then unattended', 'Triggers on any event Malini emits']}
	panel={routinePanel}
/>

<SectionHeading
	id="open"
	beat={beat('open')}
	title="Open source, so we can’t rug pull you."
	quiet="Fork it if we ever go wrong."
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

<FeatureRow
	id="docs"
	beat={beat('docs', 'Docs')}
	title="Docs your agent can read too."
	body="Add .md to any docs URL for plain markdown. Your agent reads the same pages you do, and every event Malini emits is documented."
	href={docHref('/docs')}
	linkLabel="Read the docs"
	checks={[
		'llms.txt and llms-full.txt, built from the docs',
		'The events reference is generated from the code',
	]}
	header={terminalHeader}
	panel={terminalPanel}
/>

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

<section id="start" class="beat closing" aria-labelledby="start-title">
	<div class="wrap">
		<div class="close">
			<div class="glow" aria-hidden="true"></div>
			<BeatLabel {...beat('start')} />
			<div class="end">
				<div class="rise">
					<h2 id="start-title">Start with the task you’ve put off.</h2>
					<p class="sub">
						Download Malini, connect Claude Code and GitHub, and ship the thing you wish already
						existed.
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
	.progress {
		display: none;
	}

	@supports (animation-timeline: scroll()) {
		.progress {
			position: fixed;
			z-index: 50;
			inset: 0 0 auto;
			display: block;
			height: 3px;
			background: var(--painting);
			transform-origin: 0 50%;
			animation: fill linear both;
			animation-timeline: scroll(root);
		}
	}

	@keyframes fill {
		from {
			scale: 0 1;
		}
	}

	.intro {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding-top: 72px;
		padding-bottom: 64px;
	}

	.intro > *,
	.window {
		animation: blur-in calc(var(--duration) * var(--pace)) var(--enter-ease)
			calc(var(--delay) * var(--pace)) backwards;
	}

	.eyebrow {
		--rise: 3px;
		--blur: 8px;
		--duration: 1200ms;
		--delay: 250ms;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 12px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		color: var(--fg-secondary);
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
	}

	.eyebrow :global(.ahead) {
		width: 11px;
		height: 11px;
		color: var(--fg-faint);
	}

	h1 {
		--rise: 4px;
		--blur: 12px;
		--duration: 1400ms;
		--delay: 0ms;
		margin-top: 24px;
		font-size: clamp(38px, 6vw, 68px);
		font-weight: 550;
		line-height: 1.02;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	h1 span {
		white-space: nowrap;
	}

	.quiet {
		color: var(--fg-faint);
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

	.plate {
		--seam: linear-gradient(
			90deg,
			transparent 4%,
			#1957fa 18%,
			#6365cd 32%,
			#9e6594 44%,
			#d35351 58%,
			#ed3e11 70%,
			#fb8400 82%,
			transparent 96%
		);
		isolation: isolate;
		padding: 64px 0;
		background: linear-gradient(var(--panel) 0 0) 50% 0 / var(--col) 100% no-repeat;
		animation: seam calc(1600ms * var(--pace)) var(--enter-ease) calc(450ms * var(--pace)) backwards;
	}

	@property --grow {
		syntax: '<number>';
		inherits: true;
		initial-value: 1;
	}

	.horizon,
	.gl {
		position: absolute;
		z-index: -1;
		pointer-events: none;
	}

	.horizon {
		inset: -46% calc(50% - var(--col) / 2) auto;
		height: 90%;
		background: var(--painting);
		mask-image: radial-gradient(
			closest-side,
			light-dark(rgb(0 0 0 / 0.42), rgb(0 0 0 / 0.86)) 18%,
			transparent
		);
		filter: blur(48px);
		opacity: 0.85;
		clip-path: inset(calc(100% * 46 / 90) 0 0 0);
		animation: swell calc(1600ms * var(--pace)) var(--enter-ease) calc(450ms * var(--pace))
			backwards;
	}

	.gl {
		inset: 0 calc(50% - var(--col) / 2);
		color: var(--panel);
		animation: grow calc(1600ms * var(--pace)) var(--enter-ease) calc(450ms * var(--pace)) backwards;
	}

	.window {
		--rise: 6px;
		--blur: 8px;
		--duration: 1400ms;
		--delay: 350ms;
		position: relative;
		container-type: inline-size;
	}

	.shot {
		display: block;
		width: 100%;
		height: auto;
		border-radius: calc(100cqi * 46 / 2560);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08),
			0 32px 64px -24px rgb(0 0 0 / 0.45);
	}

	@keyframes grow {
		from {
			--grow: 0;
		}
	}

	@keyframes swell {
		from {
			opacity: 0;
			scale: 0.6;
		}
	}

	@keyframes seam {
		from {
			--seam-w: 0;
		}
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
		.eyebrow:hover {
			box-shadow: inset 0 0 0 1px var(--border-default);
			color: var(--fg-default);
		}

		.eyebrow:hover :global(.ahead) {
			translate: 2px 0;
		}

		summary:hover .plus::before,
		summary:hover .plus::after {
			background: var(--fg-default);
		}

		.faq-intro a:hover {
			text-decoration-color: var(--fg-default);
		}
	}

	@media (max-width: 1023px) {
		.intro {
			padding-top: 56px;
		}

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

	@media (max-width: 639px) {
		h1 span {
			display: block;
			white-space: normal;
		}

		.plate {
			padding: 40px 0;
		}

		.window {
			padding-inline: 12px;
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

	@media (prefers-reduced-motion: reduce) {
		.intro > *,
		.window {
			animation: fade-in 400ms ease backwards;
		}

		.horizon,
		.gl,
		.plate {
			animation: none;
		}
	}
</style>
