<script lang="ts">
	import { BrowserTab } from '@malini/hyper-ui/components/browser-tab';
	import { LoadingCircle } from '@malini/hyper-ui/components/loading-circle';
	import { BusyIcon, Icon } from '@malini/hyper-ui/icons';
	import type { Attachment } from 'svelte/attachments';
	import { cubicOut, quartOut } from 'svelte/easing';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import { Loop } from './loop.svelte';
	import './app-ui/app-ui.api';

	type Frame = Readonly<{
		zone: 'idle' | 'queued';
		busy: boolean;
		label: string;
		detail: string | null;
		actions: 'ship' | 'merge' | 'merge-neutral' | 'cancel' | null;
		reference: boolean;
		job: string | null;
		finished: number;
		archived: boolean;
	}>;

	const local: Frame = {
		zone: 'idle',
		busy: false,
		label: '2 files changed',
		detail: null,
		actions: 'ship',
		reference: false,
		job: null,
		finished: 0,
		archived: false,
	};
	const draft: Frame = { ...local, reference: true, actions: 'merge' };
	const queued: Frame = {
		...draft,
		zone: 'queued',
		busy: true,
		label: 'Queued for merge',
		actions: 'cancel',
		finished: 1,
	};
	const merging: Frame = { ...queued, label: 'Merging', actions: null, finished: 3 };

	const frames: readonly Frame[] = [
		local,
		{ ...local, busy: true, label: 'Opening draft', actions: null },
		{ ...draft, busy: true, label: 'Checks running', detail: '3 of 3 pending' },
		{
			...draft,
			busy: true,
			label: 'Clearing blockers',
			actions: 'merge-neutral',
			job: 'Address review',
		},
		{ ...draft, busy: true, label: 'Checks running', detail: '2 of 3 pending', finished: 1 },
		{ ...draft, label: 'Checks failed', detail: 'test (node 24)', finished: 1 },
		{ ...draft, busy: true, label: 'Queueing merge', actions: null, finished: 1 },
		queued,
		{ ...queued, detail: 'Clearing blockers', job: 'Update from main' },
		{ ...queued, detail: 'Waiting for checks', finished: 2 },
		{ ...queued, detail: 'Clearing blockers', job: 'Fix checks', finished: 2 },
		{ ...queued, detail: 'Waiting for checks', finished: 3 },
		{ ...queued, detail: 'Waiting for review', finished: 3 },
		merging,
		{ ...merging, archived: true },
	];

	const loop = new Loop([
		2200, 1300, 1400, 2400, 1000, 1600, 600, 1000, 2400, 1200, 2400, 1200, 1500, 1400, 3400,
	]);
	let cycle = 0;
	let previousStep = loop.step;
	const layer = $derived.by(() => {
		const step = loop.step;
		if (step < previousStep) cycle += 1;
		previousStep = step;
		return { cycle, frame: frames[step] ?? local };
	});

	let jobSeconds = $state(0);
	let toastMounted = $state(false);

	function jobSummary(frame: Frame): string {
		if (frame.job) return '1 running';
		return frame.finished > 0 ? `${frame.finished} finished recently` : 'ready when you are';
	}

	$effect(() => {
		if (!layer.frame.job) return;
		jobSeconds = 0;
		const clock = setInterval(() => (jobSeconds += 1), 1_000);
		return () => clearInterval(clock);
	});

	const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const fadeOnly = (duration: number): TransitionConfig => ({
		duration,
		css: (t) => `opacity: ${t};`,
	});

	function textIn(_node: Element): TransitionConfig {
		if (reducedMotion()) return fadeOnly(160);
		return {
			duration: 220,
			easing: quartOut,
			css: (t, u) => `opacity: ${t}; translate: 0 ${u * 5}px; filter: blur(${u * 2}px);`,
		};
	}

	function textOut(_node: Element): TransitionConfig {
		if (reducedMotion()) return fadeOnly(120);
		return {
			duration: 140,
			easing: cubicOut,
			css: (t, u) => `opacity: ${t}; translate: 0 ${u * -5}px; filter: blur(${u * 2}px);`,
		};
	}

	function actionIn(_node: Element): TransitionConfig {
		if (reducedMotion()) return fadeOnly(160);
		return {
			duration: 220,
			easing: quartOut,
			css: (t, u) => `opacity: ${t}; scale: ${1 - u * 0.06}; filter: blur(${u * 2}px);`,
		};
	}

	function actionOut(_node: Element): TransitionConfig {
		if (reducedMotion()) return fadeOnly(120);
		return {
			duration: 140,
			easing: cubicOut,
			css: (t, u) => `opacity: ${t}; scale: ${1 - u * 0.06};`,
		};
	}

	function unfold(node: HTMLElement): TransitionConfig {
		if (reducedMotion()) return fadeOnly(160);
		const width = node.offsetWidth;
		const gap = Number.parseFloat(getComputedStyle(node.parentElement ?? node).columnGap) || 0;
		return {
			duration: 260,
			easing: quartOut,
			css: (t, u) => `width: ${t * width}px; margin-right: ${u * -gap}px; opacity: ${t};`,
		};
	}

	const mountToast: Attachment<HTMLElement> = (node) => {
		node.getBoundingClientRect();
		const frameId = requestAnimationFrame(() => (toastMounted = true));
		return () => {
			cancelAnimationFrame(frameId);
			toastMounted = false;
		};
	};
</script>

{#snippet chevronRight()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="m9 18 6-6-6-6" />
	</svg>
{/snippet}

{#snippet filesIcon()}
	<span class="grid place-items-center"><Icon name="files" size={14} /></span>
{/snippet}

{#snippet folderShape(fill: string)}
	<path
		{fill}
		d="m6.922 3.768-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232"
	/>
{/snippet}

{#snippet jobRow(title: string, time: string)}
	<div class="group flex items-center gap-2 rounded-xl pr-1">
		<span class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-xl pl-2 text-left text-xs">
			<span class="text-fg-secondary grid size-4 shrink-0 place-items-center">
				<LoadingCircle size={12} />
			</span>
			<span class="min-w-0 flex-1 truncate">
				<span class="text-fg-default font-medium">{title}</span>
				<span class="text-fg-tertiary">· Rate limit headers</span>
			</span>
		</span>
		<span class="grid shrink-0 place-items-center">
			<span class="text-fg-tertiary text-2xs justify-self-end pr-1 tabular-nums [grid-area:1/1]">
				{time}
			</span>
		</span>
	</div>
{/snippet}

{#snippet jobCenter(frame: Frame, placement: string)}
	<section
		class={[
			'border-surface-50-border bg-surface-50 flex flex-col overflow-hidden rounded-3xl border-[0.5px] p-2',
			placement,
		]}
	>
		<div class="flex h-8 shrink-0 items-center gap-2 pl-2">
			<p class="flex min-w-0 flex-1 items-center gap-2 text-xs">
				<span class="text-fg-secondary grid size-4 shrink-0 place-items-center">
					{#if frame.job}
						<LoadingCircle size={12} />
					{:else}
						<Icon name="checklist" size={13} />
					{/if}
				</span>
				<span class="min-w-0 flex-1 truncate">
					<span class="text-fg-default font-medium">Jobs</span>
					<span class="text-fg-tertiary">· {jobSummary(frame)}</span>
				</span>
			</p>
			<span
				class="text-fg-secondary inline-flex aspect-square h-6 shrink-0 items-center justify-center rounded-full"
			>
				<Icon name="settings" size={13} />
			</span>
		</div>
		{#if frame.job || frame.finished > 0}
			<div class="min-h-0 overflow-y-auto">
				{#if frame.job}
					<ul>
						<li>{@render jobRow(frame.job, `${jobSeconds}s`)}</li>
					</ul>
				{/if}
				{#if frame.finished > 0}
					<span
						class="text-fg-tertiary flex h-7 w-full items-center gap-2 rounded-xl px-2 text-left text-xs"
					>
						<span class="grid size-4 shrink-0 place-items-center">
							<Icon name="chevron-right" size={12} />
						</span>
						<span class="min-w-0 flex-1">Recent</span>
						<span class="text-2xs pr-1 tabular-nums">{frame.finished}</span>
					</span>
				{/if}
			</div>
		{/if}
	</section>
{/snippet}

<div
	class="app-ui merge-mock"
	role="img"
	aria-label="A demo of Malini's merge queue in a workstream's inspector. A draft pull request opens, the Address review job answers a reviewer, and the checks fail. After Merge is pressed, the status goes from Queued for merge through Clearing blockers, Waiting for checks and Waiting for review to Merging while the Job center runs Update from main and Fix checks. Then the workstream is archived and a toast says the pull request merged."
	data-nosnippet
	{@attach loop.play}
>
	{#each [layer] as current (current.cycle)}
		{@const frame = current.frame}
		<div class="frame" inert transition:fade={{ duration: 400 }}>
			{#if !frame.archived}
				<div class="dock">
					<div class="topbar-git" data-zone={frame.zone}>
						{#if frame.reference}
							<div class="topbar-git__pill" transition:unfold>
								<span class="topbar-git__pill-part">#142</span>
								<span class="topbar-git__pill-part topbar-git__pill-link">
									<Icon name="external-link" size={12} />
								</span>
							</div>
						{/if}
						<span class="topbar-git__status">
							{#key `${frame.busy} ${frame.label}`}
								<span class="topbar-git__line" in:textIn out:textOut>
									{#if frame.busy}
										<BusyIcon size={12} />
									{/if}
									<span class="topbar-git__text">
										<span class="topbar-git__label">{frame.label}</span>
										{#if frame.detail}
											<span class="topbar-git__detail">
												{#key frame.detail}
													<span in:textIn out:textOut>{frame.detail}</span>
												{/key}
											</span>
										{/if}
									</span>
								</span>
							{/key}
						</span>
						{#if frame.actions}
							<span class="topbar-git__action-slot" in:actionIn out:actionOut>
								{#if frame.actions === 'ship'}
									<span class="topbar-action topbar-git__action" data-tone="secondary">Draft</span>
								{/if}
								{#if frame.actions === 'cancel'}
									<span class="topbar-action topbar-git__action" data-tone="secondary">Cancel</span>
								{:else}
									<span
										class="topbar-action topbar-git__action"
										data-tone={frame.actions === 'merge-neutral' ? 'secondary' : 'primary'}
									>
										Merge
									</span>
								{/if}
							</span>
						{/if}
					</div>
				</div>
			{/if}

			<div class="inspector-column flex min-h-0 min-w-0 flex-col overflow-hidden">
				{#if !frame.archived}
					<section
						class="bg-surface-50 border-surface-50-border relative z-[51] mt-7 mr-3 mb-3 flex min-h-0 min-w-0 shrink flex-col overflow-hidden rounded-3xl border-[0.5px]"
					>
						<div class="flex h-12 shrink-0 items-center gap-1 px-4 pt-1">
							<div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
								<BrowserTab label="Files" selected closeLabel="" icon={filesIcon} />
								<span class="shrink-0">
									<span class="flex size-7 items-center justify-center">
										<span
											class="text-fg-tertiary relative grid size-5 place-items-center rounded-sm"
										>
											<Icon name="plus" size={14} />
										</span>
									</span>
								</span>
							</div>
							<span
								class="text-fg-secondary inline-flex aspect-square h-7 shrink-0 items-center justify-center rounded-full"
							>
								<Icon name="chevron-right" size={13} />
							</span>
						</div>
						<div class="files-panel">
							<div class="files-band">
								<span class="files-toggle">
									<span class="files-toggle-label">
										<span class="files-chevron">{@render chevronRight()}</span>
										<span>Files</span>
									</span>
									<span class="files-summary">8</span>
								</span>
								<span class="files-scope">
									<span>Changed</span>
									<span class="files-scope-count">2</span>
								</span>
							</div>
							<div class="files-tree">
								<span class="tree-row" data-folder data-modified>
									<span class="tree-twisty">{@render chevronRight()}</span>
									<svg class="tree-icon" viewBox="0 0 16 16" aria-hidden="true">
										{@render folderShape('#4caf50')}
										<path
											fill="#c8e6c9"
											d="M9.225 15a.5.5 0 0 1-.12-.014.57.568 0 0 1-.414-.661l1.549-7.872a.566.565 0 0 1 .254-.372.53.53 0 0 1 .4-.067.57.57 0 0 1 .415.662l-1.552 7.872a.56.56 0 0 1-.253.371.53.53 0 0 1-.28.081m3.105-1h-.038a.54.54 0 0 1-.382-.206.583.582 0 0 1 .057-.774l2.664-2.483-2.653-2.312a.583.582 0 0 1-.08-.772.54.54 0 0 1 .377-.218.53.53 0 0 1 .406.129l3.126 2.727a.579.578 0 0 1 .002.862l-3.114 2.904a.536.535 0 0 1-.365.144zm-4.661 0a.536.535 0 0 1-.365-.146L4.186 10.95a.58.58 0 0 1-.005-.846l.01-.01 3.128-2.726a.516.515 0 0 1 .4-.13.54.54 0 0 1 .38.218.583.582 0 0 1-.08.773l-2.65 2.31 2.663 2.482a.579.578 0 0 1 .056.774.536.535 0 0 1-.381.206z"
										/>
									</svg>
									<span class="tree-name">src</span>
									<span class="tree-stat">
										<span data-tone="addition">+41</span>
										<span data-tone="deletion">−9</span>
									</span>
								</span>
								<span class="tree-row" data-folder data-modified>
									<span class="tree-twisty">{@render chevronRight()}</span>
									<svg class="tree-icon" viewBox="0 0 16 16" aria-hidden="true">
										{@render folderShape('#00bfa5')}
										<path
											fill="#a7ffeb"
											d="M8 6v1h1v6a2 2 0 0 0 4 0V7h1V6Zm2.5 7a.5.5 0 1 1 .5-.5.5.5 0 0 1-.5.5m1-2a.5.5 0 1 1 .5-.5.5.5 0 0 1-.5.5m.5-2h-2V7h2z"
										/>
									</svg>
									<span class="tree-name">tests</span>
									<span class="tree-stat"><span data-tone="addition">+15</span></span>
								</span>
								<span class="tree-row">
									<span class="tree-twisty"></span>
									<svg class="tree-icon" viewBox="0 0 24 24" aria-hidden="true">
										<path
											fill="#8bc34a"
											d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18m-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z"
										/>
									</svg>
									<span class="tree-name">CHANGELOG.md</span>
								</span>
								<span class="tree-row">
									<span class="tree-twisty"></span>
									<svg class="tree-icon" viewBox="0 0 32 32" aria-hidden="true">
										<path
											fill="#8bc34a"
											d="M16 20.003v2h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2v-2h4v-2h-4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v2Z"
										/>
										<path
											fill="#8bc34a"
											d="m16 3.003-12 7v14l4 2h6v-13.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v11.5H8l-2-1.034V11.15l10-5.833 10 5.833v11.703l-10 5.833-1.745-1.022L13 29.253l3 1.75 12-7v-14Z"
										/>
									</svg>
									<span class="tree-name">package.json</span>
								</span>
								<span class="tree-row">
									<span class="tree-twisty"></span>
									<svg class="tree-icon" viewBox="0 0 16 16" aria-hidden="true">
										<path
											fill="#42a5f5"
											d="M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7 7-3.136 7-7-3.136-7-7-7m1 11H7V7.5h2zm0-6H7V4h2z"
										/>
									</svg>
									<span class="tree-name">README.md</span>
								</span>
							</div>
						</div>
					</section>
				{/if}

				{#if !frame.archived}
					{@render jobCenter(frame, 'relative z-10 mt-auto mr-3 mb-3 shrink-0')}
				{/if}
			</div>

			{#if frame.archived}
				<div class="archived-stack">
					<div class="toaster">
						<div class="toast-lane" data-mounted={toastMounted} {@attach mountToast}>
							<div
								class="border-surface-toast-border bg-surface-toast text-fg-default flex overflow-hidden rounded-xl border-[0.5px] text-sm antialiased shadow-lg"
							>
								<div class="flex w-max max-w-full shrink-0 items-center gap-3 p-2">
									<div
										class="bg-success-content/12 flex size-8 shrink-0 items-center justify-center rounded-lg"
									>
										<Icon name="check" size={16} class="text-success-content" />
									</div>
									<span class="min-w-0 break-words whitespace-normal">
										Merged #142 · Rate limit headers archived
									</span>
								</div>
							</div>
						</div>
					</div>
					{@render jobCenter(frame, 'shadow-popup z-30 w-72')}
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.merge-mock {
		position: relative;
		height: 100%;
		overflow: hidden;
	}

	.frame {
		position: absolute;
		inset: 0;
		background: var(--color-surface-root);
	}

	.inspector-column {
		position: absolute;
		inset: 40px 0 0 12px;
	}

	.archived-stack {
		position: absolute;
		right: 12px;
		bottom: 12px;
		left: 12px;
		z-index: 70;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 16px;
	}

	.toaster {
		display: flex;
		max-width: min(460px, calc(100% - 4px));
		justify-content: flex-end;
		margin-right: 4px;
		clip-path: inset(-100vh -100vw -16px -100vw);
	}

	.dock {
		--dock-ink: var(--color-fg-secondary);
		--dock-tint: transparent;
		--dock-edge: var(--color-surface-50-border);
		--dock-stripe: light-dark(var(--color-surface-root-selected), var(--color-surface-50-border));
		position: absolute;
		top: 12px;
		right: 12px;
		left: 12px;
		isolation: isolate;
		display: flex;
		height: 80px;
		align-items: center;
		gap: 4px;
		border: 0.5px solid var(--dock-edge);
		border-bottom: 0;
		border-radius: 24px 24px 0 0;
		background: linear-gradient(var(--dock-tint), var(--dock-tint)), var(--color-surface-50);
		padding: 0 16px 24px;
	}

	.dock::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		background: repeating-linear-gradient(225deg, var(--dock-stripe) 0 1px, transparent 0 50%) 0 0 /
			8px 8px;
		mask-image: linear-gradient(
			to bottom,
			black,
			color-mix(in srgb, black 35%, transparent) calc(100% - 24px)
		);
		pointer-events: none;
	}

	.dock:has(.topbar-git[data-zone='queued']) {
		--dock-ink: var(--color-queued-content);
		--dock-tint: color-mix(in srgb, var(--color-queued-content) 12%, transparent);
	}

	.dock:has(.topbar-git:not([data-zone='idle'])) {
		--dock-edge: color-mix(in srgb, var(--dock-ink) 40%, transparent);
		--dock-stripe: color-mix(in srgb, var(--dock-ink) 16%, transparent);
	}

	.toast-lane {
		display: flex;
		min-width: 0;
		opacity: 0;
		transform: translateY(100%);
		transition:
			transform 400ms,
			opacity 400ms;
	}

	.toast-lane[data-mounted='true'] {
		opacity: 1;
		transform: translateY(0);
	}

	.files-panel {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		color: var(--color-fg-default);
	}

	.files-band {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.25rem;
		padding-right: 0.625rem;
	}

	.files-toggle {
		display: flex;
		min-width: 0;
		min-height: 2.25rem;
		flex: 1;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem 0.25rem 0.75rem;
		color: var(--color-fg-tertiary);
	}

	.files-toggle-label {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.25rem;
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.files-chevron {
		display: grid;
		width: 0.75rem;
		height: 0.75rem;
		flex: none;
		transform: rotate(90deg);
		color: var(--color-fg-tertiary);
	}

	.files-summary {
		display: flex;
		flex: none;
		align-items: baseline;
		gap: 0.375rem;
		color: var(--color-fg-tertiary);
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
	}

	.files-scope {
		display: inline-flex;
		height: 1.5rem;
		align-items: center;
		gap: 0.25rem;
		border-radius: 0.375rem;
		padding: 0 0.5rem;
		color: var(--color-fg-tertiary);
		font-size: var(--text-2xs);
		white-space: nowrap;
	}

	.files-scope-count {
		color: var(--color-fg-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.files-tree {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		padding: 0.125rem 0.375rem 0.5rem;
	}

	.tree-row {
		display: flex;
		width: 100%;
		height: 1.75rem;
		min-height: 1.75rem;
		align-items: center;
		gap: 0.5rem;
		border-radius: var(--radius-lg);
		padding-right: 0.75rem;
		padding-left: 0.5rem;
	}

	.tree-twisty {
		display: grid;
		width: 1rem;
		height: 1rem;
		flex: none;
		place-items: center;
		color: var(--color-fg-tertiary);
	}

	.tree-twisty :global(svg),
	.files-chevron :global(svg) {
		width: 0.75rem;
		height: 0.75rem;
	}

	.tree-icon {
		width: 1rem;
		height: 1rem;
		flex: none;
	}

	.tree-name {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		color: var(--color-fg-secondary);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tree-row[data-folder] .tree-name {
		color: var(--color-fg-default);
	}

	.tree-row[data-modified] .tree-name {
		color: var(--syntax-modified);
	}

	.tree-stat {
		display: flex;
		flex: none;
		gap: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-3xs);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		line-height: 1rem;
	}

	.tree-stat [data-tone='addition'] {
		color: var(--color-success-content);
	}

	.tree-stat [data-tone='deletion'] {
		color: var(--color-error-content);
	}

	.topbar-action {
		display: inline-flex;
		flex-shrink: 0;
		height: var(--topbar-control-height, 26px);
		align-items: center;
		gap: 6px;
		border: 0.5px solid var(--color-button-secondary-border);
		border-radius: var(--topbar-control-radius, 7px);
		background: color-mix(in srgb, var(--color-surface-150) 68%, transparent);
		padding: 0 10px;
		font-size: var(--text-2xs);
		font-weight: 500;
		color: var(--color-fg-secondary);
	}

	.topbar-action[data-tone='primary'] {
		border-color: transparent;
		background: var(--color-button-primary);
		color: var(--color-button-primary-content);
	}

	.topbar-git {
		--zone-ink: var(--color-fg-secondary);
		--zone-edge: var(--color-button-secondary-border);
		--topbar-control-height: 24px;
		--topbar-control-radius: 5px;
		display: flex;
		height: 32px;
		min-width: 0;
		flex: 1 1 auto;
		align-items: center;
		gap: 10px;
	}

	.topbar-git[data-zone='queued'] {
		--zone-ink: var(--color-queued-content);
	}

	.topbar-git:not([data-zone='idle']) {
		--zone-edge: color-mix(in srgb, var(--zone-ink) 30%, transparent);
		--color-button-primary: var(--zone-ink);
		--color-button-primary-hover: color-mix(in srgb, var(--zone-ink) 88%, transparent);
	}

	.topbar-git__pill {
		display: flex;
		height: var(--topbar-control-height);
		flex-shrink: 0;
		overflow: hidden;
		border: 0.5px solid var(--zone-edge);
		border-radius: var(--topbar-control-radius);
		font-size: var(--text-2xs);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--zone-ink);
	}

	.topbar-git__pill-part {
		display: inline-flex;
		align-items: center;
		padding: 0 8px;
		color: inherit;
	}

	.topbar-git__pill-link {
		border-left: 0.5px solid var(--zone-edge);
		padding: 0 6px;
	}

	.topbar-git__status,
	.topbar-git__detail {
		display: grid;
		min-width: 0;
		grid-template-columns: minmax(0, 1fr);
	}

	.topbar-git__status {
		flex: 1 1 auto;
		color: var(--zone-ink);
	}

	.topbar-git__status > *,
	.topbar-git__detail > * {
		grid-area: 1 / 1;
	}

	.topbar-git__line {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
		font-size: var(--text-sm);
		line-height: 16px;
		white-space: nowrap;
	}

	.topbar-git__line > :global(svg) {
		flex-shrink: 0;
	}

	.topbar-git__text {
		display: flex;
		height: 16px;
		min-width: 0;
		flex: 1 1 auto;
		flex-wrap: wrap;
		align-content: flex-start;
		column-gap: 6px;
		overflow: hidden;
	}

	.topbar-git__label,
	.topbar-git__detail > * {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.topbar-git__label {
		min-width: 0;
		font-weight: 500;
	}

	.topbar-git__detail {
		flex: 1 1 4.5em;
		color: color-mix(in srgb, var(--zone-ink) 64%, transparent);
	}

	.topbar-git__action-slot {
		display: flex;
		flex-shrink: 0;
		gap: 4px;
		margin-left: auto;
		transform-origin: right center;
	}

	.topbar-git__action {
		gap: 4px;
		padding: 0 8px;
	}

	.topbar-git .topbar-action[data-tone='secondary'] {
		border-color: var(--zone-edge);
		background: color-mix(in srgb, var(--zone-ink) 8%, transparent);
		color: var(--zone-ink);
	}

	@media (prefers-reduced-motion: reduce) {
		.toast-lane {
			transition: none;
		}
	}
</style>
