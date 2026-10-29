<script lang="ts">
	import hero from '../../../../.github/readme/hero.webp';
	import { GitHubIcon } from '@malini/hyper-ui/icons';
	import type { Snippet } from 'svelte';
	import Arrow from '$lib/Arrow.svelte';
	import Glow, { type Layer } from '$lib/Glow.svelte';
	import { demoHref, GITHUB_URL } from '$lib/links';

	let { og = false, children }: { og?: boolean; children?: Snippet } = $props();

	const HORIZON: readonly Layer[] = [{ box: [0, -0.46, 1, 0.9], peak: [0.42, 0.86], start: 0.18 }];
	const APP_WIDTH = 1280;
	const APP_HEIGHT = 860;

	let width = $state(APP_WIDTH);
	let ready = $state(false);
</script>

<section class="hero" class:og aria-labelledby="hero-title" data-place="hero">
	<div class="wrap intro">
		<a class="eyebrow" href={GITHUB_URL}>
			<GitHubIcon size={14} />
			<span>Free and open source macOS app</span>
			<Arrow class="ahead" />
		</a>
		<h1 id="hero-title">
			<span>Agentic development environment</span>
			<span class="quiet">for builders moving fast.</span>
		</h1>
		{@render children?.()}
	</div>
	<div class="plate beat">
		<div class="horizon" aria-hidden="true"></div>
		<div class="gl" aria-hidden="true">
			<Glow layers={HORIZON} opacity={0.85} />
		</div>
		<div class="wrap window">
			{#if og}
				<img
					class="shot"
					src={hero}
					width="2560"
					height="1600"
					alt="The Malini window: six workstreams across malini, grip, and tony in the sidebar, a finished chat, and Draft and Merge above 2 changed files"
				/>
			{:else}
				<div
					class="shot app"
					bind:clientWidth={width}
					style:--fit={width / APP_WIDTH}
					style:aspect-ratio="{APP_WIDTH} / {APP_HEIGHT}"
				>
					<iframe
						src={demoHref('app', '/workstreams/ws-og-lead', 'hero')}
						width={APP_WIDTH}
						height={APP_HEIGHT}
						title="Malini, running in your browser on demo data"
						class:ready
						onload={() => (ready = true)}
					></iframe>
				</div>
			{/if}
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

	.app {
		overflow: hidden;
		background: light-dark(#fbfbfb, #191919);
	}

	iframe {
		display: block;
		border: 0;
		transform-origin: 0 0;
		scale: var(--fit);
		opacity: 0;
		transition: opacity 500ms var(--enter-ease);
	}

	iframe.ready {
		opacity: 1;
	}

	.og .intro {
		padding-top: 56px;
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

		iframe {
			pointer-events: none;
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
