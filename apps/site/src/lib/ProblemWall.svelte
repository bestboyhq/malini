<script lang="ts">
	import { Loop, steps } from './loop.svelte';
	import TerminalLines, { type TerminalLine } from './TerminalLines.svelte';

	const LINES: readonly TerminalLine[] = [
		{ kind: 'tool', tool: 'Update', text: 'src/lib/auth/LoginButton.svelte' },
		{ kind: 'result', text: 'Updated with 1 addition and 1 removal' },
		{ kind: 'tool', tool: 'Bash', text: 'pnpm test' },
		{ kind: 'result', text: '… +1,204 lines (ctrl+o to expand)' },
		{
			kind: 'say',
			text: 'Done! The login button works again. Here’s a full summary of what I changed.',
		},
		{ kind: 'heading', text: 'Summary' },
		{
			kind: 'para',
			text: 'The login button sent two sign-in requests per click. I traced it to a missing `type` attribute and fixed it with a one-line change.',
		},
		{ kind: 'heading', text: 'Background' },
		{
			kind: 'para',
			text: 'Sign-in has gone through `LoginButton` since the auth rewrite in March. People reported being signed out right after signing in, mostly on slow connections, where the two requests were more likely to race.',
		},
		{ kind: 'heading', text: 'How I found it' },
		{ kind: 'item', text: 'Reproduced the bug with network throttling set to Slow 4G.' },
		{ kind: 'item', text: 'Logged every call to `signIn()` with a stack trace.' },
		{ kind: 'item', text: 'Saw two calls per click, one from `onclick`, one from `onsubmit`.' },
		{ kind: 'item', text: 'Confirmed the button had no `type` attribute.' },
		{ kind: 'heading', text: 'Root cause' },
		{ kind: 'item', text: '`LoginButton` calls `signIn()` from its click handler.' },
		{ kind: 'item', text: 'The button sits inside a `<form>` and has no `type`.' },
		{ kind: 'item', text: 'So the browser treats it as `type="submit"`.' },
		{ kind: 'item', text: 'Each click fires the handler, then the form’s submit event.' },
		{ kind: 'item', text: 'The form’s `onsubmit` calls `signIn()` a second time.' },
		{ kind: 'heading', text: 'What I changed' },
		{ kind: 'item', text: 'Added `type="button"` to the button.' },
		{ kind: 'heading', text: 'Why this approach' },
		{ kind: 'para', text: 'I considered four alternatives before settling on this one:' },
		{ kind: 'item', text: 'Debouncing `signIn()`. Hides the symptom, keeps the bug.' },
		{ kind: 'item', text: 'Removing the click handler. Changes Enter key behavior.' },
		{ kind: 'item', text: 'Calling `preventDefault()`. Couples the button to its form.' },
		{ kind: 'item', text: 'Moving sign-in to a store. Cleaner, but a bigger change.' },
		{ kind: 'heading', text: 'Files changed' },
		{
			kind: 'table',
			rows: [
				['File', 'Change'],
				['LoginButton.svelte', '+1 −1'],
			],
		},
		{ kind: 'heading', text: 'Testing' },
		{ kind: 'item', text: 'All 214 tests pass.' },
		{ kind: 'item', text: '`pnpm check` reports no type errors.' },
		{ kind: 'heading', text: 'Accessibility' },
		{
			kind: 'para',
			text: 'No change. The button keeps its role, its label and its place in the focus order, and Enter still submits the form.',
		},
		{ kind: 'heading', text: 'Performance' },
		{
			kind: 'para',
			text: 'One request per click instead of two, so sign-in is now slightly faster.',
		},
		{ kind: 'heading', text: 'Browser support' },
		{
			kind: 'para',
			text: 'Tested in Chrome, Safari and Firefox, on macOS and Windows. All three treat a button without a `type` as `submit`, so the fix holds everywhere.',
		},
		{ kind: 'heading', text: 'Risks' },
		{ kind: 'para', text: 'Low. That said, a few things are worth keeping in mind:' },
		{ kind: 'item', text: 'Code that relied on the double submit now sees one. I found none.' },
		{ kind: 'item', text: 'Password managers may autofill a little differently.' },
		{ kind: 'heading', text: 'Also noticed' },
		{
			kind: 'para',
			text: 'The sign-up form has the same pattern. I left it alone for now, since you only asked about sign-in.',
		},
		{ kind: 'heading', text: 'Next steps' },
		{ kind: 'para', text: 'If you’d like, I can:' },
		{ kind: 'item', text: 'Add a lint rule that requires a `type` on every button.' },
		{ kind: 'item', text: 'Write a regression test that counts sign-in requests.' },
		{ kind: 'item', text: 'Audit the other 37 forms in `src/` for the same pattern.' },
		{ kind: 'heading', text: 'TL;DR' },
		{ kind: 'item', text: 'Added `type="button"`. One line.' },
		{ kind: 'para', text: 'Let me know if you’d like me to make any other changes!' },
	];

	const countWords = (text: string) => text.split(/\s+/).filter((word) => /\w/.test(word)).length;

	const SHOWN_AT_START = 4;
	const SPINNER = ['✻', '✶', '✳', '✢', '·', '✢', '✳', '✶'];

	const loop = new Loop(steps(LINES.length - SHOWN_AT_START + 1, 190, 4200));
	const shown = $derived(LINES.slice(0, SHOWN_AT_START + loop.step));
	const done = $derived(loop.step === loop.last);
	const words = $derived(
		shown
			.slice(SHOWN_AT_START)
			.reduce(
				(sum, line) => sum + countWords('rows' in line ? line.rows.flat().join(' ') : line.text),
				0,
			),
	);
</script>

<div class="wall" {@attach loop.play}>
	<div class="bar">
		<span class="dots">
			<i></i>
			<i></i>
			<i></i>
		</span>
		<span class="title">claude · ~/acme/web</span>
		<span class="count">
			<b>{words}</b>
			words
		</span>
	</div>
	<div class="scroll">
		<TerminalLines lines={shown} />
	</div>
	<div class="status">
		{#if done}
			✻ Elaborated for 2m 41s
		{:else}
			{SPINNER[loop.step % SPINNER.length]} Elaborating…
			<span class="meta">(esc to interrupt)</span>
		{/if}
	</div>
	<div class="prompt">
		&gt; <span class="caret"></span>
	</div>
</div>

<style>
	.wall {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	.bar {
		display: flex;
		flex: none;
		align-items: center;
		gap: 12px;
		height: 34px;
		padding: 0 14px;
		border-bottom: 1px solid var(--term-line);
		background: var(--term-2);
		color: var(--term-dim);
		font-size: 11px;
	}

	.dots {
		display: flex;
		gap: 6px;
	}

	.dots i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--term-raised);
	}

	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count b {
		color: var(--term-fg);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.scroll {
		display: flex;
		flex: 1;
		flex-direction: column;
		justify-content: flex-end;
		min-height: 0;
		overflow: hidden;
		padding: 0 16px;
		mask-image: linear-gradient(transparent, #000 48px);
	}

	.status {
		flex: none;
		overflow: hidden;
		padding: 6px 16px 0;
		color: var(--term-clay);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		color: var(--term-dim);
	}

	.prompt {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		height: 32px;
		margin: 6px 12px 12px;
		padding: 0 10px;
		border: 1px solid var(--term-edge);
		border-radius: 6px;
		color: var(--term-dim);
	}

	.caret {
		width: 7px;
		height: 15px;
		background: var(--term-dim);
		animation: blink 1.1s steps(1) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.caret {
			animation: none;
		}
	}
</style>
