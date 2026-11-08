<script lang="ts">
	import { GitHubIcon } from '@malini/hyper-ui/icons';
	import type { Snippet } from 'svelte';
	import Arrow from '$lib/Arrow.svelte';
	import Glow, { type Layer } from '$lib/Glow.svelte';
	import SetupLoupe from '$lib/SetupLoupe.svelte';
	import { GITHUB_URL } from '$lib/urls';

	let { og = false, children }: { og?: boolean; children?: Snippet } = $props();

	const HORIZON: readonly Layer[] = [{ box: [0, -0.46, 1, 0.9], peak: [0.42, 0.86], start: 0.18 }];
	let lit = $state(false);
</script>

<section class="hero" class:og aria-labelledby="hero-title" data-place="hero">
	<div class="wrap intro">
		<a class="eyebrow" href={GITHUB_URL}>
			<GitHubIcon size={14} />
			<span>Free and open source macOS app</span>
			<Arrow class="ahead" />
		</a>
		<h1 id="hero-title">
			<span>Missing abstraction layer</span>
			<span class="quiet">for building with agents</span>
		</h1>
		{@render children?.()}
	</div>
	<div class="plate beat">
		{#if !lit}
			<div class="horizon" aria-hidden="true"></div>
		{/if}
		<div class="gl" aria-hidden="true">
			<Glow layers={HORIZON} opacity={0.85} bind:lit />
		</div>
		<div class="wrap window">
			<SetupLoupe />
		</div>
	</div>
</section>

<style>
	.intro {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding-top: 72px;
		padding-bottom: 64px;
	}

	.intro > :global(*),
	.window {
		animation:
			blur-in calc(var(--duration) * var(--pace)) var(--enter-ease) calc(var(--delay) * var(--pace))
				backwards,
			unblur calc(var(--duration) * var(--pace) * 0.705) var(--unblur-ease)
				calc(var(--delay) * var(--pace)) backwards;
	}

	.eyebrow {
		--rise: 3px;
		--blur: 8px;
		--duration: 1200ms;
		--delay: 250ms;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 11px 0 10px;
		white-space: nowrap;
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
		font-size: clamp(38px, 5.2vw, 68px);
		font-weight: 550;
		line-height: 1.02;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	h1 span {
		display: block;
	}

	.quiet {
		color: var(--fg-faint);
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
		--delay: 350ms;
		isolation: isolate;
		padding: 64px 0;
		background: linear-gradient(var(--panel) 0 0) 50% 0 / var(--col) 100% no-repeat;
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

	.og .intro {
		padding-top: 56px;
		padding-bottom: 72px;
	}

	.og .intro > :global(*),
	.og .window,
	.og .horizon,
	.og .gl,
	.og .plate::before {
		animation: none;
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

	@media (hover: hover) and (pointer: fine) {
		.eyebrow:hover {
			box-shadow: inset 0 0 0 1px var(--border-default);
			color: var(--fg-default);
		}

		.eyebrow:hover :global(.ahead) {
			translate: 2px 0;
		}
	}

	@media (max-width: 1023px) {
		.intro {
			padding-top: 56px;
		}
	}

	@media (max-width: 639px) {
		.plate {
			padding: 40px 0;
		}

		.window {
			padding-inline: 12px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.intro > :global(*),
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
