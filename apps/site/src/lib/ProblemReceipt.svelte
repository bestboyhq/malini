<script lang="ts">
	import { ticker } from './loop.svelte';
	import RollingNumber from './RollingNumber.svelte';

	let tokensIn = $state(1_284_019);
	let tokensOut = $state(92_410);
</script>

<div
	class="till"
	{@attach ticker(450, () => {
		tokensIn += Math.round(2600 + Math.random() * 1800);
		tokensOut += Math.round(70 + Math.random() * 110);
	})}
>
	<div class="slot"></div>
	<div class="paper">
		<div class="center">AGENT TOOL</div>
		<div class="center soft">one long chat</div>
		<hr />
		<div class="row">
			<span>Tokens in</span>
			<RollingNumber value={tokensIn} />
		</div>
		<div class="row">
			<span>Tokens out</span>
			<RollingNumber value={tokensOut} />
		</div>
		<div class="row">
			<span>Same file, again</span>
			<span>×6</span>
		</div>
		<hr />
		<div class="row">
			<span>Tool by</span>
			<span>a token seller</span>
		</div>
		<div class="row">
			<span>Tokens by</span>
			<span>same one</span>
		</div>
		<hr />
		<div class="row total">
			<span>Reason to sell less</span>
			<span>0</span>
		</div>
		<hr />
		<div class="center">THANK YOU. COME AGAIN</div>
	</div>
</div>

<style>
	.till {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		min-height: 0;
		background: radial-gradient(120% 80% at 50% 0%, var(--term-card), var(--term) 70%);
	}

	.slot {
		flex: none;
		width: 74%;
		max-width: 280px;
		height: 8px;
		border-radius: 0 0 6px 6px;
		background: var(--term-slot);
		box-shadow: inset 0 -1px 0 var(--term-line);
	}

	.paper {
		width: calc(74% - 24px);
		max-width: 256px;
		margin-top: -2px;
		padding: 14px 16px 22px;
		background: #ece7df;
		box-shadow: 0 12px 24px rgb(0 0 0 / 0.4);
		color: #2b2825;
		font-size: 11px;
		line-height: 17px;
		mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 10px 100%;
		animation: print 2.6s steps(14) 0.6s both;
	}

	:global(.rise[data-reveal='wait']) .paper {
		animation-play-state: paused;
	}

	@keyframes print {
		from {
			clip-path: inset(0 0 100% 0);
			translate: 0 -40px;
		}
	}

	.center {
		letter-spacing: 0.06em;
		text-align: center;
	}

	.soft {
		color: #7a756f;
		letter-spacing: 0;
	}

	hr {
		margin: 8px 0;
		border: 0;
		border-top: 1px dashed #a39d95;
	}

	.row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		white-space: nowrap;
	}

	.row span:last-child {
		font-variant-numeric: tabular-nums;
	}

	.total {
		font-weight: 700;
	}

	@media (prefers-reduced-motion: reduce) {
		.paper {
			animation: none;
		}
	}
</style>
