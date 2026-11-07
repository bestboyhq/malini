<script lang="ts">
	import type { Component } from 'svelte';
	import { Icon } from '@malini/hyper-ui/icons';
	import type { Beat } from './BeatLabel.svelte';
	import ProblemReceipt from './ProblemReceipt.svelte';
	import ProblemRules from './ProblemRules.svelte';
	import ProblemTabs from './ProblemTabs.svelte';
	import ProblemWall from './ProblemWall.svelte';
	import SectionHeading from './SectionHeading.svelte';

	let { beat }: { beat: Beat } = $props();

	const pains: readonly { title: string; body: string; visual: Component }[] = [
		{
			title: 'Four hundred words about one line',
			body: 'The agent changed one line, then wrote it up. Headings, a table, risks, next steps. The part you needed is in there somewhere.',
			visual: ProblemWall,
		},
		{
			title: 'Six tabs, six essays',
			body: 'Every agent ends its turn the same way, with a long and proud summary. You meant to build things. Somehow you became their editor.',
			visual: ProblemTabs,
		},
		{
			title: 'Same rules, four files',
			body: 'Each agent wants its own rulebook, so you copy yours by hand. One copy is always a few weeks behind. Guess which.',
			visual: ProblemRules,
		},
		{
			title: 'The meter is always running',
			body: 'Agent tools come from the people who sell the tokens. Lovely people. Just not in a hurry to sell you fewer.',
			visual: ProblemReceipt,
		},
	];

	const notFor = ['VCs', 'Stakeholders', 'Whoever sells the tokens'];
</script>

<SectionHeading
	id="problem"
	{beat}
	split
	title="You weren’t meant to read"
	quiet="walls of text all day."
	description="Yet here we all are. Agents write the code, and we scroll their terminals like it’s the morning news."
>
	{#snippet after()}
		<ul class="pains">
			{#each pains as pain (pain.title)}
				<li class="rise">
					<div class="visual" aria-hidden="true"><pain.visual /></div>
					<h3>{pain.title}</h3>
					<p>{pain.body}</p>
				</li>
			{/each}
		</ul>
		<div class="question">
			<div class="asked rise">
				<p class="kicker">So we asked one question</p>
				<h3>
					What would an agent tool look like <span class="quiet">if it put you first?</span>
				</h3>
			</div>
			<div class="ballot rise">
				<p class="kicker">Who it answers to</p>
				<ul>
					{#each notFor as who (who)}
						<li class="no">
							<span class="mark" aria-hidden="true"></span>
							<s>
								<span class="hidden">Not</span>
								{who}
							</s>
						</li>
					{/each}
					<li class="yes">
						<span class="mark" aria-hidden="true"><Icon name="check" size={14} /></span>
						You
					</li>
				</ul>
				<p class="came">Malini is what we came up with.</p>
			</div>
		</div>
		<div class="cloud rise">
			<h3><Icon name="cloud-off" size={20} />No cloud, on purpose.</h3>
			<p>
				The only people asking us for one would take a margin on hosting you. It’s not forever. The
				market hasn’t made up its mind, and we’re in no rush.
			</p>
		</div>
	{/snippet}
</SectionHeading>

<style>
	.pains {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		margin: 72px calc(-1 * max(var(--pad), env(safe-area-inset-left))) 0;
		border-bottom: 1px solid var(--frame);
		list-style: none;
	}

	.pains > li {
		display: flex;
		flex-direction: column;
		padding: 40px var(--pad) 48px;
		border-top: 1px solid var(--frame);
	}

	.pains > li:nth-child(even) {
		border-left: 1px solid var(--frame);
	}

	.visual {
		--term: #141312;
		--term-2: #0d0c0b;
		--term-card: #1d1b1a;
		--term-raised: #2e2c2a;
		--term-slot: #050505;
		--term-edge: #4a4744;
		--term-fg: #d6d2ce;
		--term-dim: #8a8580;
		--term-faint: #5f5b57;
		--term-line: rgb(255 255 255 / 0.07);
		--term-ok: #62c073;
		--term-wait: #e8b86f;
		--term-clay: #d97757;
		--term-pick: #9db7f5;
		display: flex;
		flex-direction: column;
		height: 280px;
		overflow: hidden;
		border-radius: 14px;
		background: var(--term);
		box-shadow:
			var(--app-shadow),
			0 0 0 1px light-dark(rgb(24 20 19 / 0.14), var(--app-line));
		color: var(--term-fg);
		font: 400 11.5px/18px var(--mono);
		font-variant-ligatures: none;
		user-select: none;
		-webkit-user-select: none;
		overflow-anchor: none;
	}

	h3 {
		font-size: 20px;
		font-weight: 550;
		line-height: 1.35;
		letter-spacing: -0.015em;
		text-wrap: balance;
	}

	.pains h3 {
		margin-top: 28px;
	}

	.pains p,
	.cloud p {
		max-width: 480px;
		color: var(--fg-muted);
		font-size: 15px;
		line-height: 1.6;
		text-wrap: pretty;
	}

	.pains p {
		margin-top: 8px;
	}

	.question {
		display: grid;
		grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
		gap: 48px 80px;
		padding: 112px 0;
	}

	.kicker {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 24px;
	}

	.asked h3 {
		margin-top: 12px;
		font-size: clamp(32px, 4vw, 44px);
		line-height: 1.1;
		letter-spacing: -0.03em;
	}

	.quiet {
		color: var(--fg-faint);
	}

	.ballot ul {
		margin-top: 12px;
		list-style: none;
	}

	.ballot li {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 12px 0;
		border-bottom: 1px solid var(--frame);
		font-size: 20px;
		font-weight: 500;
		line-height: 28px;
		letter-spacing: -0.015em;
	}

	.no {
		color: var(--fg-faint);
	}

	s {
		text-decoration-thickness: 1.5px;
		text-decoration-color: var(--fg-muted);
	}

	.mark {
		display: grid;
		flex: none;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		box-shadow: inset 0 0 0 1.5px var(--border-strong);
	}

	.yes .mark {
		background: var(--success);
		box-shadow: none;
		color: var(--surface-root);
	}

	.hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.came {
		margin-top: 20px;
		color: var(--fg-muted);
		font-size: 17px;
		line-height: 1.55;
	}

	.cloud {
		display: grid;
		grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
		gap: 12px 80px;
		margin: 0 calc(-1 * max(var(--pad), env(safe-area-inset-left)));
		padding: 40px max(var(--pad), env(safe-area-inset-left)) 48px;
		border-top: 1px solid var(--frame);
	}

	.cloud h3 {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.cloud h3 :global(svg) {
		flex: none;
		color: var(--fg-muted);
	}

	.cloud p {
		padding-top: 2px;
	}

	@media (max-width: 1023px) {
		.pains {
			grid-template-columns: minmax(0, 1fr);
		}

		.pains > li:nth-child(even) {
			border-left: 0;
		}
	}

	@media (max-width: 859px) {
		.question,
		.cloud {
			grid-template-columns: minmax(0, 1fr);
		}

		.question {
			padding: 80px 0;
		}
	}

	@media (max-width: 559px) {
		.pains > li {
			padding: 32px var(--pad) 40px;
		}

		.visual {
			height: 300px;
		}
	}
</style>
