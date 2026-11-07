<script lang="ts">
	import { messageType, shotOf, type Shot } from './camera';
	import { playLoupe, type Use } from './loupe';
	import { demoHref } from './urls';

	type Step = Use & Readonly<{ row: number; tag: string }>;

	const ROWS_MESSAGE = 'malini-demo:rows';

	const APP_WIDTH = 1200;
	const NARROW = 860;
	const NARROW_AT = 0.8;

	const POOLS: readonly (readonly string[])[] = [
		[
			'~/.claude/CLAUDE.md',
			'## Done means done',
			'Checked in the app.',
			'## Act. Don’t ask.',
			'Reversible and cheap? Do it.',
			'## A question is a question',
			'Answer it. Do not implement it.',
			'## One big pull request',
			'Never stack pull requests.',
			'',
			'.claude/skills/',
			'  adr/SKILL.md',
			'  draw-icon/SKILL.md',
			'  test-malini-app/SKILL.md',
			'',
		],
		[
			'~/.claude/',
			'  CLAUDE.md',
			'  settings.json',
			'  hooks/',
			'    block-email.sh',
			'    guard-secrets.sh',
			'  skills/',
			'    animate/  humanizer/  prototype/',
			'  plugins/',
			'    svelte@svelte',
			'    code-simplifier  context7  figma',
			'~/.claude.json',
			'  mcpServers',
			'    codebase-memory-mcp',
			'',
		],
		[
			'~/.claude/settings.json',
			'{',
			'  "permissions": {',
			'    "allow": ["Bash(pnpm check:*)", "Bash(gh pr view:*)"]',
			'  },',
			'  "hooks": {',
			'    "PreToolUse": [',
			'      { "matcher": "Bash", "command": "rtk hook claude" },',
			'      { "matcher": "*", "command": "block-email.sh" },',
			'      { "matcher": "Bash|Read|Edit", "command": "guard-secrets.sh" }',
			'    ]',
			'  },',
			'  "enabledPlugins": {',
			'    "svelte@svelte": true,',
			'    "code-simplifier@claude-plugins-official": true,',
			'    "context7@claude-plugins-official": true',
			'  }',
			'}',
			'',
		],
	];

	const STEPS: readonly Step[] = [
		{
			row: 1,
			tag: 'the repo’s skill',
			col: 0,
			color: '#c5a0f0',
			at: 0.36,
			lines: ['.claude/skills/', '  draw-icon/', '    SKILL.md'],
		},
		{
			row: 3,
			tag: 'your plugin',
			col: 2,
			color: '#5fb3a1',
			at: 0.5,
			lines: ['"enabledPlugins": {', '  "svelte@svelte": true'],
		},
		{
			row: 4,
			tag: 'your hook, passed',
			col: 2,
			color: '#82aef7',
			at: 0.34,
			lines: ['"PreToolUse": [', '  "guard-secrets.sh"'],
		},
		{
			row: 4,
			tag: 'allowed by your rule',
			col: 2,
			color: '#62c073',
			at: 0.62,
			lines: ['"allow": [', '  "Bash(pnpm check:*)"'],
		},
		{
			row: 5,
			tag: 'your rules',
			col: 0,
			color: '#e8b86f',
			at: 0.44,
			lines: ['~/.claude/CLAUDE.md', '## Done means done', 'Checked in the app.'],
		},
		{
			row: 6,
			tag: 'the repo’s skill',
			col: 0,
			color: '#c5a0f0',
			at: 0.58,
			lines: ['.claude/skills/', '  test-malini-app/', '    SKILL.md'],
		},
	];

	let stage = $state<HTMLElement>();
	let glass = $state<HTMLElement>();
	let lens = $state<HTMLElement>();
	let canvas = $state<HTMLCanvasElement>();
	let frame = $state<HTMLIFrameElement>();
	let cols = $state<HTMLElement[]>([]);
	let width = $state(0);
	let height = $state(0);
	let rows = $state<(Shot | null)[]>([]);
	let step = $state(-1);
	let loaded = $state(false);

	const narrow = $derived(width > 0 && width < NARROW);
	const pools = $derived(narrow ? [POOLS.flat()] : POOLS);
	const scale = $derived(Math.min(1, Math.max(0.6, width / APP_WIDTH)));
	const app = $derived(Math.max(APP_WIDTH, Math.round(width / scale)));
	const placed = $derived(rows.filter((shot) => shot !== null));
	const chat = $derived(
		placed.length
			? (Math.min(...placed.map((shot) => shot.x)) +
					Math.max(...placed.map((shot) => shot.x + shot.width))) /
					2
			: app / 2,
	);
	const offset = $derived(Math.min(0, Math.max(width - app * scale, width / 2 - chat * scale)));
	const ready = $derived(loaded && placed.length > 0);
	const lit = $derived(STEPS[step]);
	const row = $derived(lit ? rows[lit.row] : undefined);

	function rowsOf(data: unknown): (Shot | null)[] {
		const listed = typeof data === 'object' && data !== null && 'rows' in data ? data.rows : null;
		return Array.isArray(listed) ? listed.map(shotOf) : [];
	}

	$effect(() => {
		const hear = (event: MessageEvent): void => {
			if (event.source !== frame?.contentWindow || event.origin !== location.origin) return;
			if (messageType(event.data) === ROWS_MESSAGE) rows = rowsOf(event.data);
		};
		addEventListener('message', hear);
		return () => removeEventListener('message', hear);
	});

	$effect(() => {
		const boxes = cols.slice(0, pools.length);
		if (!stage || !glass || !lens || !canvas || !boxes.every(Boolean)) return;
		return playLoupe({
			stage,
			glass,
			lens,
			canvas,
			cols: boxes,
			pools,
			uses: narrow ? STEPS.map((use) => ({ ...use, col: 0, at: NARROW_AT })) : STEPS,
			resting: 4,
			show: (index) => (step = index),
		});
	});
</script>

<div
	class={['stage', { narrow }]}
	role="img"
	aria-label="A Malini chat adds Duplicate to a chat tab’s menu. It loads a skill from the repository, calls a plugin’s tool, passes a hook, runs a command a permission rule allows, and checks its work in the app because CLAUDE.md says so. A loupe moves over the window and magnifies the line of your own Claude Code setup each step came from: CLAUDE.md, settings.json and the skills folder."
	bind:this={stage}
	bind:clientWidth={width}
	bind:clientHeight={height}
>
	<div class="mess" aria-hidden="true">
		{#each pools, index (index)}
			<div class="col" bind:this={cols[index]}><div class="feed"></div></div>
		{/each}
	</div>
	<div class="glass" aria-hidden="true" bind:this={glass}>
		<iframe
			bind:this={frame}
			src={demoHref('app', '/workstreams/ws-malini-duplicate', 'setup')}
			title="Malini on demo data"
			width={app}
			height={Math.round(height / scale)}
			style:scale
			style:translate="{offset}px 0"
			tabindex="-1"
			inert
			class:ready
			onload={() => (loaded = true)}
		></iframe>
		<i
			class={['lit', { on: row }]}
			style:--tint={lit?.color}
			style:translate={row ? `${offset + row.x * scale - 6}px ${row.y * scale}px` : null}
			style:width={row ? `${row.width * scale + 12}px` : null}
			style:height={row ? `${row.height * scale}px` : null}
		>
			<span class="tag">{lit?.tag}</span>
		</i>
	</div>
	<canvas class="gl" aria-hidden="true" bind:this={canvas}></canvas>
	<div class="lens" aria-hidden="true" bind:this={lens}></div>
</div>
<p class="legend" aria-hidden="true">
	<span>On top: Malini.</span>
	<span>Underneath: your Claude Code, as you left it.</span>
</p>

<style>
	.stage {
		--loupe: 320px;
		position: relative;
		aspect-ratio: 1280 / 860;
		overflow: hidden;
		border-radius: calc(100cqi * 46 / 2560);
		background: light-dark(#f4f1ee, #0f0e0d);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08),
			0 32px 64px -24px rgb(0 0 0 / 0.45);
		isolation: isolate;
		user-select: none;
		-webkit-user-select: none;
	}

	.mess {
		position: absolute;
		inset: 0;
		display: flex;
		color: light-dark(#8a8580, #8f8b85);
		font: 400 11px/16px var(--mono);
		font-variant-ligatures: none;
	}

	.col {
		flex: none;
		overflow: hidden;
		padding-left: 24px;
		mask-image: linear-gradient(90deg, #000 calc(100% - 16px), transparent);
	}

	.col:nth-child(1) {
		width: 27%;
	}

	.col:nth-child(2) {
		flex: 1 0 0;
		box-shadow: inset 1px 0 light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.06));
	}

	.col:nth-child(3) {
		width: 31%;
		mask-image: none;
		box-shadow: inset 1px 0 light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.06));
	}

	.narrow .col:nth-child(1) {
		width: 100%;
		mask-image: none;
	}

	.feed {
		will-change: translate;
	}

	.mess :global(.line) {
		position: relative;
		z-index: 0;
		height: 16px;
		white-space: pre;
	}

	.mess :global(.c) {
		color: light-dark(#a19c97, #6b6762);
	}

	.mess :global(.s) {
		color: light-dark(#5f7f2c, #b2d48a);
	}

	.mess :global(.o) {
		color: light-dark(#297a3a, #62c073);
	}

	.mess :global(.w) {
		color: light-dark(#7a52b3, #c5a0f0);
	}

	.mess :global(.f) {
		color: light-dark(#6b6762, #a7a39d);
	}

	.mess :global(.hot) {
		color: light-dark(#201f1d, #e2ded8);
	}

	.mess :global(.hot::before) {
		content: '';
		position: absolute;
		inset: 0 0 0 -24px;
		z-index: -1;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--hot) 60%, transparent),
			color-mix(in srgb, var(--hot) 22%, transparent) 60%,
			transparent
		);
		box-shadow: inset 2px 0 0 var(--hot);
	}

	.glass {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--app-root);
		mask-image: radial-gradient(circle at 50% 50%, transparent 146px, #000 160px);
	}

	iframe {
		position: absolute;
		top: 0;
		left: 0;
		border: 0;
		opacity: 0;
		pointer-events: none;
		transform-origin: 0 0;
		transition: opacity 500ms var(--enter-ease);
	}

	iframe.ready {
		opacity: 1;
	}

	.lit {
		position: absolute;
		top: 0;
		left: 0;
		border-radius: 6px;
		background: color-mix(in srgb, var(--tint) 12%, transparent);
		box-shadow: inset 2px 0 0 var(--tint);
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 400ms ease,
			translate 700ms var(--ease),
			width 700ms var(--ease),
			height 700ms var(--ease);
	}

	.lit.on {
		opacity: 1;
	}

	.tag {
		position: absolute;
		top: 50%;
		right: 6px;
		padding: 0 6px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--tint) 18%, var(--app-root));
		color: light-dark(color-mix(in srgb, var(--tint) 55%, #000), var(--tint));
		font: 500 11px/18px var(--mono);
		white-space: nowrap;
		translate: 0 -50%;
		transition: color 500ms ease;
	}

	.gl {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.lens {
		position: absolute;
		top: 0;
		left: 0;
		width: var(--loupe);
		height: var(--loupe);
		border-radius: 50%;
		box-shadow:
			inset 0 0 36px rgb(0 0 0 / 0.5),
			0 0 0 1px rgb(0 0 0 / 0.2),
			0 0 48px rgb(0 0 0 / 0.25);
		pointer-events: none;
		will-change: translate;
	}

	.stage:not([data-webgl]) .gl,
	.stage:global([data-webgl]) .lens {
		display: none;
	}

	.legend {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		margin-top: 20px;
		color: var(--fg-faint);
		font: 12px/16px var(--mono);
	}

	@media (max-width: 639px) {
		.stage {
			aspect-ratio: 9 / 16;
		}

		.legend {
			flex-direction: column;
			gap: 4px;
		}
	}
</style>
