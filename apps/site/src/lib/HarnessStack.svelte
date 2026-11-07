<script lang="ts">
	import { BrandIcon, ClaudeIcon, DeepSeekIcon, Icon, OpenCodeIcon } from '@malini/hyper-ui/icons';
	import { Loop } from './loop.svelte';

	type Provider = 'Claude' | 'ChatGPT' | 'OpenCode' | 'DeepSeek';

	type Detail = { name: string; line: string; facts: readonly string[] };

	const top: Detail = {
		name: 'Malini',
		line: "Type, read, ship. That's the job",
		facts: [
			'a composer and a model chip',
			'reports: what changed, how it was checked',
			'Open draft · Merge',
		],
	};

	const layers = [
		{
			name: 'Claude Code',
			note: 'Tools, subagents, plan mode, hooks',
			etch: [
				'Read · Edit · Write · Bash · Grep',
				'subagents · plan mode · skills · PreToolUse hooks',
			],
			line: 'The real one. Not a lookalike',
			facts: [
				'MCP servers from .mcp.json',
				'your ~/.claude skills and settings',
				'same harness on every model',
			],
		},
		{
			name: 'Context',
			note: 'Compacts at 280K',
			etch: [],
			line: 'Puts every message back',
			facts: [
				"280K, not Claude Code's 1M",
				'a long Opus chat: a quarter less plan',
				'keeps 86% of what mattered, not 70%',
			],
		},
		{
			name: 'Sandbox',
			note: 'Deny by default',
			etch: [
				'sandbox-exec -f sandbox.sb · deny default',
				'hides ~/.ssh ~/.aws ~/.gnupg · 39 mach services',
			],
			line: 'Sees the repo. Not your keys',
			facts: [
				'hides ~/.ssh ~/.aws ~/.gnupg ~/.kube',
				'no clipboard, no screen capture',
				'never writes git hooks or .mcp.json',
			],
		},
		{
			name: 'Worktree',
			note: 'A branch per task',
			etch: ['git worktree add -b malini/<id> <path>', 'deps per worktree · git worktree prune'],
			line: 'Tasks never share a folder',
			facts: [
				'git worktree add -b malini/<id>',
				'dependencies install per worktree',
				'git worktree prune cleans up',
			],
		},
		{
			name: 'Routing',
			note: 'Env vars, a proxy, sealed keys',
			etch: [
				'ANTHROPIC_BASE_URL · ANTHROPIC_AUTH_TOKEN=sk-••••',
				'ChatGPT proxy 127.0.0.1:<port> · keys in safeStorage',
			],
			line: 'Set per model. Never typed',
			facts: [],
		},
	] as const;

	const bottom: Detail = {
		name: 'Model',
		line: 'The only part that changes',
		facts: [
			'about 30 models, four providers',
			'Claude, ChatGPT plan, OpenCode, DeepSeek',
			'list from models.dev, hourly',
		],
	};

	const ROUTING = 5;

	const models: readonly {
		name: string;
		provider: Provider;
		plan: string;
		route: readonly string[];
	}[] = [
		{
			name: 'Opus 5.5',
			provider: 'Claude',
			plan: 'Claude',
			route: [
				'your Claude sign-in, no key',
				'no proxy, no base URL',
				'CLAUDE_CODE_EFFORT_LEVEL=high',
			],
		},
		{
			name: 'GPT-6 Luna',
			provider: 'ChatGPT',
			plan: 'ChatGPT plan',
			route: [
				'ANTHROPIC_BASE_URL=127.0.0.1:<port>',
				'a private proxy to your ChatGPT plan',
				'ANTHROPIC_MODEL=gpt-6-luna',
			],
		},
		{
			name: 'Kimi K3',
			provider: 'OpenCode',
			plan: 'OpenCode',
			route: [
				'ANTHROPIC_BASE_URL=opencode.ai/…/anthropic',
				'ANTHROPIC_AUTH_TOKEN=sk-••••',
				'ANTHROPIC_MODEL=kimi-k3',
			],
		},
		{
			name: 'DeepSeek V4 Pro',
			provider: 'DeepSeek',
			plan: 'DeepSeek',
			route: [
				'ANTHROPIC_BASE_URL=api.deepseek.com/anthropic',
				'ANTHROPIC_AUTH_TOKEN=sk-••••',
				'ANTHROPIC_MODEL=deepseek-v4-pro',
			],
		},
	];

	const details: readonly Detail[] = [top, ...layers, bottom];

	const loop = new Loop(models.map(() => 2600));

	let tiltX = $state(0);
	let tiltY = $state(0);
	let pulled = $state(-1);
	let shown = $state(0);

	const model = $derived(models[loop.step]);
	const detail = $derived.by((): Detail | undefined =>
		shown === ROUTING && model
			? { name: 'Routing', line: `Set for ${model.name}. Never typed`, facts: model.route }
			: details[shown],
	);

	function pull(layer: number): void {
		pulled = layer;
		if (layer >= 0) shown = layer;
		loop.held = layer >= 0;
	}

	function point(event: PointerEvent): void {
		const owner = event.target instanceof Element ? event.target.closest('[data-layer]') : null;
		pull(owner instanceof HTMLElement ? Number(owner.dataset.layer) : -1);
	}

	function tilt(event: PointerEvent): void {
		if (event.pointerType !== 'mouse' || !(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		tiltY = ((event.clientX - box.left) / box.width - 0.5) * 10;
		tiltX = ((event.clientY - box.top) / box.height - 0.5) * 6;
	}

	function rest(event: PointerEvent): void {
		if (event.pointerType === 'touch') return;
		tiltX = 0;
		tiltY = 0;
		pull(-1);
	}
</script>

{#snippet logo(provider: Provider, size: number)}
	{#if provider === 'Claude'}
		<ClaudeIcon {size} />
	{:else if provider === 'ChatGPT'}
		<BrandIcon brand="openai" {size} />
	{:else if provider === 'OpenCode'}
		<OpenCodeIcon {size} />
	{:else}
		<DeepSeekIcon {size} />
	{/if}
{/snippet}

<div
	class={['stage', 'rise', { pointing: pulled >= 0 }]}
	role="img"
	aria-label="An exploded stack of seven layers. From the top: Malini with its composer and a report, Claude Code, context that compacts at 280K tokens, the sandbox, the worktree, provider routing, and the model. The model at the bottom swaps from Opus 5.5 to GPT-6 Luna, Kimi K3 and DeepSeek V4 Pro, and the six layers above it stay the same."
	style:--tilt-x="{tiltX}deg"
	style:--tilt-y="{tiltY}deg"
	onpointermove={tilt}
	onpointerover={point}
	onpointerleave={rest}
	{@attach loop.play}
>
	<div class="frame" aria-hidden="true">
		<div class="tilt">
			<div class="scene">
				<div class={['layer', { pulled: pulled === 0 }]} style:--layer={0}>
					<i class="hit" data-layer={0}></i>
					<div class="plate app">
						<div class="bar">
							<span class="dots">
								<i></i>
								<i></i>
								<i></i>
							</span>
							<span class="repo">grip</span>
							<span class="btn">Open draft</span>
							<span class="btn primary">Merge</span>
						</div>
						<div class="report">
							<p class="outcome">
								<span class="ok"><Icon name="check" size={13} /></span>
								Captions land on the word as it is spoken
							</p>
							<p class="note">
								<Icon name="delta" size={11} />
								a caption shows when its word starts, 180 ms sooner
							</p>
							<p class="note">
								<span class="ok"><Icon name="shield-check" size={11} /></span>
								<span>
									<code>npm test -- transcript</code>
									passes
								</span>
							</p>
							<p class="note">
								<Icon name="chevrons-right" size={11} />
								hold each caption until the next word starts
							</p>
							<p class="acts">
								<span class="btn primary">Ship</span>
								<span class="btn">Note it</span>
							</p>
						</div>
						<div class="composer">
							<span class="placeholder">Ask Malini to make a change…</span>
							<span class="composer-row">
								<span class="chips">
									{#each models as model, index (model.name)}
										<span
											class={['chip', model.provider.toLowerCase(), { on: index === loop.step }]}
										>
											{@render logo(model.provider, 11)}
											{model.name}
											<em>· High</em>
										</span>
									{/each}
								</span>
								<span class="send"><Icon name="arrow-up" size={11} /></span>
							</span>
						</div>
					</div>
					{@render tag(0, 'Malini', 'What you see')}
				</div>

				{#each layers as layer, index (layer.name)}
					<div class={['layer', { pulled: pulled === index + 1 }]} style:--layer={index + 1}>
						<i class="hit" data-layer={index + 1}></i>
						<div class="plate glass">
							<div class="etch">
								<b>{layer.name}</b>
								{#if layer.etch.length === 0}
									<span class="meter">
										<span class="track"><i></i></span>
										compacts at 280K tokens
									</span>
								{/if}
								{#each layer.etch as line (line)}
									<span>{line}</span>
								{/each}
							</div>
						</div>
						{@render tag(index + 1, layer.name, layer.note)}
					</div>
				{/each}

				<div class={['layer', { pulled: pulled === 6 }]} style:--layer={6}>
					<i class="hit" data-layer={6}></i>
					<div class="floor"></div>
					{#each models as model, index (model.name)}
						<div class={['plate model', model.provider.toLowerCase(), { on: index === loop.step }]}>
							<div class="etch">
								<b>Model</b>
								<span class="model-name">
									{@render logo(model.provider, 16)}
									{model.name}
									<em>{model.plan}</em>
								</span>
							</div>
						</div>
					{/each}
					<div class="tag">
						<i class="lead"></i>
						<span class="text" data-layer={6}>
							<b class="n">1</b>
							<b class="name">Model</b>
							<span class="picks">
								{#each models as model, index (model.name)}
									<span class={['pick', model.provider.toLowerCase(), { on: index === loop.step }]}>
										{@render logo(model.provider, 14)}
										{model.name}
										<em>{model.provider}</em>
									</span>
								{/each}
							</span>
						</span>
					</div>
					{#if detail}
						<div class="readout">
							<p class="read-head">
								<b class="n">{7 - shown}</b>
								<b class="name">{detail.name}</b>
							</p>
							<p class="read-line">{detail.line}</p>
							<ul class="facts">
								{#each detail.facts as fact (fact)}
									<li>{fact}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<dl class="sr-only">
	{#each details as { name, line, facts } (name)}
		<dt>{name}</dt>
		<dd>{[line, ...facts].join('. ')}.</dd>
	{/each}
</dl>

{#snippet tag(layer: number, name: string, note: string)}
	<div class="tag">
		<i class="lead"></i>
		<span class="text" data-layer={layer}>
			<b class="n">{7 - layer}</b>
			<b class="name">{name}</b>
			<span class="tag-note">{note}</span>
		</span>
	</div>
{/snippet}

<style>
	.stage {
		--width: 420px;
		--depth: 240px;
		--scale: 1;
		--x: 372px;
		--edge-1: light-dark(#dcd8d5, rgb(58 56 54 / 0.95));
		--edge-2: light-dark(#d2cecb, rgb(44 42 40 / 0.95));
		--edge-3: light-dark(#c8c4c1, rgb(34 33 31 / 0.95));
		--edge-4: light-dark(#bfbbb8, rgb(26 25 24 / 0.95));
		--drop: light-dark(rgb(24 20 19 / 0.1), rgb(0 0 0 / 0.42));
		--pitch: 55deg;
		--yaw: 45deg;
		--pull: 40;
		--pull-x: calc(var(--pull) * sin(var(--yaw)));
		--pull-y: calc(var(--pull) * cos(var(--yaw)) * cos(var(--pitch)));
		--lead: 72;
		--reach: calc(hypot(var(--lead) - var(--pull-x), var(--pull-y)) / var(--lead));
		margin-top: 56px;
		container-type: inline-size;
		font-family: var(--sans);
	}

	.frame {
		position: relative;
		height: 680px;
		overflow: clip;
	}

	.tilt {
		position: absolute;
		top: 50%;
		left: var(--x);
		transform-style: preserve-3d;
		transform: scale(var(--scale)) rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
		transition: transform 900ms var(--ease);
	}

	.scene {
		position: absolute;
		top: calc(var(--depth) / -2);
		left: calc(var(--width) / -2);
		width: var(--width);
		height: var(--depth);
		transform-style: preserve-3d;
		transform: rotateX(var(--pitch)) rotateZ(calc(-1 * var(--yaw)));
	}

	.layer {
		position: absolute;
		inset: 0;
		transform-style: preserve-3d;
		transform: translateZ(calc(180px - var(--layer) * 60px));
	}

	.hit {
		position: absolute;
		inset: 0;
		border-radius: 14px;
	}

	.plate {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border: 1px solid var(--app-line);
		border-bottom-color: var(--app-line-strong);
		border-left-color: var(--app-line-strong);
		border-radius: 14px;
		box-shadow:
			-1px 1px 0 var(--edge-1),
			-2px 2px 0 var(--edge-2),
			-3px 3px 0 var(--edge-3),
			-4px 4px 0 var(--edge-4),
			-16px 16px 32px var(--drop);
	}

	.layer > .plate:not(.model) {
		transition:
			opacity 500ms ease-out calc(var(--layer) * 70ms),
			transform 800ms var(--ease) calc(var(--layer) * 70ms),
			translate 760ms var(--ease),
			box-shadow 760ms var(--ease);
	}

	.plate::before,
	.plate::after {
		content: '';
		position: absolute;
		inset: -1px;
		border-radius: inherit;
		opacity: 0;
		pointer-events: none;
	}

	.plate::before {
		background: linear-gradient(
			115deg,
			light-dark(rgb(255 255 255 / 0.6), color-mix(in srgb, var(--app-fg) 8%, transparent)),
			transparent 40%
		);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-fg) 20%, transparent);
		transition: opacity 600ms ease;
	}

	.plate::after {
		background: var(--surface-root);
		transition: opacity 300ms ease;
	}

	.pulled > .plate {
		translate: 0 calc(var(--pull) * 1px);
		box-shadow:
			-1px 1px 0 var(--edge-1),
			-2px 2px 0 var(--edge-2),
			-3px 3px 0 var(--edge-3),
			-4px 4px 0 var(--edge-4),
			-26px 26px 44px var(--drop);
	}

	.pulled > .plate::before {
		opacity: 1;
		transition-duration: 360ms;
	}

	.pointing .layer:not(.pulled) > .plate::after {
		opacity: 0.45;
	}

	.stage:global([data-reveal='wait']) .layer > .plate:not(.model) {
		opacity: 0;
		transform: translateZ(28px);
		transition: none;
	}

	.glass {
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--app-fg) 5%, transparent), transparent 45%),
			radial-gradient(color-mix(in srgb, var(--app-fg) 7%, transparent) 0.8px, transparent 1.2px)
				6px 6px / 12px 12px,
			color-mix(in srgb, var(--app-raised) 85%, transparent);
	}

	.etch {
		position: absolute;
		right: 16px;
		bottom: 7px;
		left: 16px;
		display: flex;
		flex-direction: column;
		gap: 1px;
		color: color-mix(in srgb, var(--app-fg) 72%, transparent);
		font-family: var(--mono);
		font-size: 11px;
		line-height: 14px;
		white-space: nowrap;
		text-shadow: 0 1px 0 light-dark(transparent, rgb(0 0 0 / 0.5));
	}

	.etch b {
		margin-bottom: 2px;
		color: var(--fg-default);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.meter {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.track {
		position: relative;
		width: 168px;
		height: 4px;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in srgb, var(--app-fg) 10%, transparent);
	}

	.track::after {
		content: '';
		position: absolute;
		top: 0;
		right: 0;
		width: 2px;
		height: 100%;
		background: var(--fg-secondary);
	}

	.track i {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: color-mix(in srgb, var(--app-fg) 42%, transparent);
		transform: scaleX(0.62);
		transform-origin: 0 50%;
		animation: fill 9s ease-in-out infinite;
	}

	@keyframes fill {
		0% {
			transform: scaleX(0.18);
		}
		80%,
		86% {
			transform: scaleX(1);
		}
		92%,
		100% {
			transform: scaleX(0.18);
		}
	}

	.app {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 11px 12px 12px;
		background: var(--app-panel);
		color: var(--app-fg);
		font-size: 11px;
		line-height: 15px;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 20px;
	}

	.dots {
		display: flex;
		gap: 5px;
		margin-right: 6px;
	}

	.dots i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--app-line-strong);
	}

	.repo {
		margin-right: auto;
		color: var(--app-fg-2);
		font-weight: 500;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border-radius: 6px;
		box-shadow: inset 0 0 0 1px var(--app-line-strong);
		color: var(--app-fg-2);
		font-size: 10px;
		font-weight: 500;
	}

	.btn.primary {
		background: var(--app-fg);
		box-shadow: none;
		color: var(--app-root);
	}

	.report {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 8px 10px;
		border-left: 3px solid color-mix(in srgb, var(--app-success) 40%, transparent);
		border-radius: 2px 8px 8px 2px;
		background: var(--app-panel);
		box-shadow: 0 0 0 1px var(--app-line);
	}

	.report p {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.report :global(svg) {
		flex: none;
	}

	.outcome {
		margin-bottom: 1px;
		font-size: 12px;
		font-weight: 500;
		line-height: 17px;
	}

	.note {
		color: var(--app-fg-3);
		font-size: 10.5px;
	}

	.ok {
		display: grid;
		color: var(--app-success);
	}

	code {
		padding: 0 3px;
		border-radius: 3px;
		background: var(--app-raised);
		color: var(--app-fg);
		font-family: var(--mono);
		font-size: 9.5px;
	}

	.report .acts {
		gap: 6px;
		margin-top: 3px;
		padding-left: 17px;
	}

	.composer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: auto;
		padding: 9px 9px 8px 11px;
		border-radius: 10px;
		background: var(--app-raised);
		box-shadow: 0 0 0 1px var(--app-line-strong);
	}

	.placeholder {
		color: var(--app-fg-3);
		font-size: 11.5px;
	}

	.composer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.chips,
	.picks {
		display: grid;
	}

	.chip {
		position: relative;
		display: inline-flex;
		grid-area: 1 / 1;
		gap: 5px;
		align-items: center;
		justify-self: start;
		height: 20px;
		padding: 0 8px 0 6px;
		border-radius: 999px;
		background: var(--app-root);
		box-shadow: 0 0 0 1px var(--app-line-strong);
		color: var(--app-fg);
		font-size: 10.5px;
		font-weight: 500;
		white-space: nowrap;
		opacity: 0;
		transition: opacity 200ms ease-in;
	}

	.chip em {
		color: var(--app-fg-3);
		font-style: normal;
		font-weight: 400;
	}

	.chip.on {
		opacity: 1;
		transition: opacity 300ms ease-out 500ms;
	}

	.chip::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: 0 0 0 1.5px var(--brand);
		opacity: 0;
	}

	.chip.on::after {
		animation: ping 1400ms ease-in-out 500ms;
	}

	@keyframes ping {
		30% {
			opacity: 1;
		}
	}

	.send {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--app-fg);
		color: var(--app-root);
	}

	.claude {
		--provider: #d97757;
	}

	.chatgpt,
	.opencode {
		--provider: var(--app-fg);
	}

	.deepseek {
		--provider: #4d6bfe;
	}

	.chip :global(svg),
	.pick :global(svg),
	.model-name :global(svg) {
		flex: none;
		color: var(--provider);
	}

	.model {
		background:
			radial-gradient(
				120% 90% at 0% 100%,
				color-mix(in srgb, var(--provider) 16%, transparent),
				transparent 60%
			),
			radial-gradient(color-mix(in srgb, var(--app-fg) 6%, transparent) 0.8px, transparent 1.2px)
				6px 6px / 12px 12px,
			color-mix(in srgb, var(--app-panel) 92%, transparent);
		border-bottom-color: color-mix(in srgb, var(--provider) 45%, transparent);
		border-left-color: color-mix(in srgb, var(--provider) 35%, transparent);
		opacity: 0;
		transform: translate(-99px, -99px);
		transition:
			transform 450ms cubic-bezier(0.55, 0, 1, 0.45),
			opacity 260ms ease-in 120ms,
			translate 760ms var(--ease),
			box-shadow 760ms var(--ease);
	}

	.model.on {
		opacity: 1;
		transform: none;
		transition:
			transform 650ms var(--ease) 500ms,
			opacity 350ms ease-out 500ms,
			translate 760ms var(--ease),
			box-shadow 760ms var(--ease);
	}

	.model-name {
		display: flex;
		gap: 8px;
		align-items: center;
		color: var(--fg-default);
		font-family: var(--sans);
		font-size: 15px;
		font-weight: 600;
		line-height: 22px;
		letter-spacing: -0.01em;
	}

	.model-name em {
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 10px;
		font-style: normal;
		font-weight: 400;
		letter-spacing: 0;
	}

	.floor {
		position: absolute;
		inset: 18px;
		border-radius: 24px;
		background: light-dark(rgb(24 20 19 / 0.16), rgb(0 0 0 / 0.6));
		filter: blur(22px);
		transform: translate(-22px, 22px) translateZ(-12px);
		pointer-events: none;
	}

	.tag,
	.readout {
		position: absolute;
		top: calc(100% - 12px);
		left: 100%;
		width: 560px;
		transform-origin: 0 12px;
		transform: rotateZ(var(--yaw)) rotateX(calc(-1 * var(--pitch)));
		pointer-events: none;
	}

	.tag {
		height: 24px;
		transition: opacity 220ms ease;
	}

	.pointing .layer:not(.pulled) > .tag {
		opacity: 0.35;
	}

	.lead {
		position: absolute;
		top: 11.5px;
		left: 4px;
		width: calc(var(--lead) * 1px);
		height: 1px;
		transform-origin: 0 50%;
		transition:
			translate 760ms var(--ease),
			rotate 760ms var(--ease),
			scale 760ms var(--ease);
	}

	.lead::before,
	.lead::after {
		content: '';
		position: absolute;
	}

	.lead::before {
		top: -2px;
		left: -6.5px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--fg-secondary);
		transform-origin: 6.5px 50%;
		transition: scale 760ms var(--ease);
	}

	.lead::after {
		inset: 0;
		background: var(--border-strong);
		transform-origin: 0 50%;
		transition: transform 450ms var(--ease) calc(300ms + var(--layer) * 70ms);
	}

	.pulled > .tag .lead {
		translate: calc(var(--pull-x) * 1px) calc(var(--pull-y) * 1px);
		rotate: atan2(calc(-1 * var(--pull-y)), calc(var(--lead) - var(--pull-x)));
		scale: var(--reach) 1;
	}

	.pulled > .tag .lead::before {
		background: var(--fg-default);
		scale: calc(1 / var(--reach)) 1;
	}

	.pulled > .tag .lead::after {
		background: var(--fg-secondary);
	}

	.text {
		position: absolute;
		top: 2px;
		left: 88px;
		display: flex;
		align-items: center;
		height: 20px;
		line-height: 20px;
		white-space: nowrap;
		pointer-events: auto;
		transition:
			opacity 400ms ease-out calc(480ms + var(--layer) * 70ms),
			transform 500ms var(--ease) calc(480ms + var(--layer) * 70ms);
	}

	.stage:global([data-reveal='wait']) .lead::after {
		transform: scaleX(0);
		transition: none;
	}

	.stage:global([data-reveal='wait']) .text {
		opacity: 0;
		transform: translateX(-6px);
		transition: none;
	}

	.n {
		width: 20px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 400;
		transition: color 220ms ease;
	}

	.pulled > .tag .n,
	.readout .n {
		color: var(--fg-default);
	}

	.name {
		width: 104px;
		color: var(--fg-default);
		font-size: 14px;
		font-weight: 500;
	}

	.tag-note {
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 12px;
	}

	.readout {
		padding: 56px 0 0 88px;
		opacity: 0;
		transition: opacity 240ms ease 160ms;
	}

	.pointing .readout {
		opacity: 1;
		transition: opacity 160ms ease-out;
	}

	.read-head {
		display: flex;
		align-items: baseline;
		line-height: 20px;
		white-space: nowrap;
	}

	.read-line {
		margin: 2px 0 0 20px;
		color: var(--fg-secondary);
		font-size: 14px;
		line-height: 20px;
		white-space: nowrap;
	}

	.facts {
		display: grid;
		gap: 1px;
		margin-top: 6px;
		padding-left: 20px;
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 18px;
		white-space: nowrap;
		list-style: none;
	}

	.pick {
		display: inline-flex;
		grid-area: 1 / 1;
		gap: 7px;
		align-items: center;
		color: var(--fg-default);
		font-size: 14px;
		font-weight: 500;
		opacity: 0;
		transform: translateX(-6px);
		transition:
			opacity 200ms ease-in,
			transform 200ms ease-in;
	}

	.pick em {
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 12px;
		font-style: normal;
		font-weight: 400;
	}

	.pick.on {
		opacity: 1;
		transform: none;
		transition:
			opacity 350ms ease-out 520ms,
			transform 500ms var(--ease) 520ms;
	}

	@container (max-width: 1079px) {
		.frame {
			height: 600px;
		}

		.tilt {
			--scale: 0.88;
			--x: 330px;
		}
	}

	@container (max-width: 959px) {
		.tag-note,
		.pick em,
		.readout {
			display: none;
		}
	}

	@container (max-width: 859px) {
		.frame {
			height: 560px;
		}

		.tilt {
			--scale: 0.8;
			--x: 300px;
		}
	}

	@container (max-width: 639px) {
		.frame {
			height: 420px;
		}

		.tilt {
			--scale: 0.6;
			--x: 50%;
		}

		.tag,
		.readout {
			display: none;
		}
	}

	@media (max-width: 1023px) {
		.stage {
			margin-top: 48px;
		}
	}

	@media (max-width: 689px) {
		.stage {
			margin-top: 40px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.stage *,
		.stage *::before,
		.stage *::after {
			transition: none !important;
			animation: none !important;
		}
	}
</style>
