<script lang="ts">
	import { onDestroy } from 'svelte';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import { playSoundCommand } from '$shared/sounds/application/commands/play-sound.command';
	import { soundChoicesQuery } from '$shared/sounds/application/queries/sound-choices.query.svelte';
	import type { SoundSignal } from '$shared/sounds/domain/sounds';

	type RowState = 'running' | SoundSignal;

	const WORKSTREAMS: readonly {
		id: string;
		name: string;
		glyph: IconName;
		added: number;
		removed: number;
	}[] = [
		{ id: 'a', name: 'Sound step in onboarding', glyph: 'pr-draft', added: 184, removed: 22 },
		{ id: 'b', name: 'Fix login redirect', glyph: 'branch', added: 12, removed: 3 },
		{ id: 'c', name: 'Flaky jobs e2e', glyph: 'pr-open', added: 41, removed: 17 },
		{ id: 'd', name: 'Pricing page copy', glyph: 'branch', added: 8, removed: 0 },
		{ id: 'e', name: 'Bump Svelte to 5.40', glyph: 'pr-draft', added: 96, removed: 88 },
	];
	const DURATION_MS = 15_000;
	const REPLY_MS = 2_800;
	const AFTERNOON_MINUTES = 300;
	const AFTERNOON: readonly { at: number; id: string; signal: SoundSignal }[] = [
		{ at: 900, id: 'b', signal: 'finished' },
		{ at: 2300, id: 'd', signal: 'needs-you' },
		{ at: 3600, id: 'a', signal: 'finished' },
		{ at: 3800, id: 'e', signal: 'finished' },
		{ at: 4050, id: 'c', signal: 'finished' },
		{ at: 6300, id: 'b', signal: 'finished' },
		{ at: 7600, id: 'd', signal: 'finished' },
		{ at: 9100, id: 'a', signal: 'needs-you' },
		{ at: 10500, id: 'c', signal: 'finished' },
		{ at: 10700, id: 'e', signal: 'finished' },
		{ at: 12400, id: 'a', signal: 'finished' },
		{ at: 13900, id: 'b', signal: 'finished' },
	];

	const choices = $derived(soundChoicesQuery.data);

	let rows = $state<Record<string, RowState>>(idle());
	let heard = $state<readonly number[]>([]);
	let elapsedMs = $state(0);
	let playing = $state(false);
	let timers: ReturnType<typeof setTimeout>[] = [];
	let frame = 0;

	const clock = $derived(clockAt(elapsedMs));

	onDestroy(stop);

	function idle(): Record<string, RowState> {
		return Object.fromEntries(WORKSTREAMS.map((workstream) => [workstream.id, 'running']));
	}

	function clockAt(ms: number): string {
		const minutes = 13 * 60 + Math.round((ms / DURATION_MS) * AFTERNOON_MINUTES);
		return `${Math.floor(minutes / 60) - 12}:${String(minutes % 60).padStart(2, '0')} PM`;
	}

	function stop(): void {
		timers.forEach(clearTimeout);
		timers = [];
		cancelAnimationFrame(frame);
		playing = false;
	}

	function onTry(): void {
		if (playing) {
			stop();
			return;
		}
		rows = idle();
		heard = [];
		elapsedMs = 0;
		playing = true;
		const began = performance.now();
		const tick = (): void => {
			elapsedMs = Math.min(performance.now() - began, DURATION_MS);
			if (elapsedMs < DURATION_MS) frame = requestAnimationFrame(tick);
			else stop();
		};
		frame = requestAnimationFrame(tick);
		AFTERNOON.forEach((moment, index) => {
			timers.push(setTimeout(() => arrive(moment, index), moment.at));
		});
	}

	function arrive(moment: (typeof AFTERNOON)[number], index: number): void {
		rows[moment.id] = moment.signal;
		heard = [...heard, index];
		playSoundCommand(choices[moment.signal]);
		if (AFTERNOON.slice(index + 1).some((next) => next.id === moment.id)) {
			timers.push(setTimeout(() => (rows[moment.id] = 'running'), REPLY_MS));
		}
	}
</script>

<section class="border-surface-50-border rounded-2xl border-[0.5px]" aria-label="Try it">
	<div class="px-2 pt-2 pb-1.5">
		<div class="text-fg-secondary flex h-8 w-full items-center gap-2 rounded-xl pr-1 pl-6">
			<span class="min-w-0 flex-1 truncate text-sm leading-relaxed font-medium">malini</span>
		</div>
		<ul class="flex w-full flex-col">
			{#each WORKSTREAMS as workstream (workstream.id)}
				{@const state = rows[workstream.id]}
				<li class="relative mt-0.5 w-full min-w-0">
					<span
						class={[
							'sidebar-row relative w-full flex-col items-stretch pr-3 pl-9',
							state === 'running' ? 'text-fg-tertiary' : 'text-500',
						]}
						data-trial-state={state}
					>
						<span class="relative flex items-center gap-2">
							<span
								class={[
									'grid h-4 w-4 shrink-0 place-items-center',
									state === 'running' && 'text-fg-secondary',
									state === 'needs-you' && 'text-warning-content',
								]}
							>
								{#if state === 'running'}
									<BusyIcon size={14} />
								{:else}
									<Icon name={workstream.glyph} size={14} />
								{/if}
							</span>
							<span class="sidebar-row-text gap-1.5">
								<span class="flex min-w-0 flex-1 truncate">{workstream.name}</span>
								<span class="text-3xs flex shrink-0 gap-1 font-mono font-medium tabular-nums">
									{#if workstream.added}
										<span class="text-success-content">+{workstream.added}</span>
									{/if}
									{#if workstream.removed}
										<span class="text-error-content">−{workstream.removed}</span>
									{/if}
								</span>
							</span>
						</span>
					</span>
				</li>
			{/each}
		</ul>
	</div>
	<div class="border-surface-50-border flex items-center gap-3 border-t-[0.5px] px-4 py-3">
		<Tooltip content={playing ? 'Stop' : 'Try it'} placement="top">
			<IconButton
				ariaLabel={playing ? 'Stop' : 'Try it'}
				variant={playing ? 'primary-soft' : 'secondary'}
				size="md"
				radius="full"
				ariaPressed={playing}
				onclick={onTry}
			>
				<Icon name={playing ? 'stop' : 'play'} size={14} />
			</IconButton>
		</Tooltip>
		<div class="relative h-4 min-w-0 flex-1" aria-hidden="true">
			<span class="bg-surface-50-selected absolute inset-x-0 top-[7px] h-0.5 rounded-full"></span>
			<span
				class="text-fg-tertiary absolute top-[7px] left-0 h-0.5 rounded-full bg-current"
				style:width={`${(elapsedMs / DURATION_MS) * 100}%`}
			></span>
			{#each AFTERNOON as moment, index (index)}
				<span
					class={[
						'absolute top-[3px] h-2.5 w-0.5 -translate-x-1/2 rounded-full',
						!heard.includes(index)
							? 'bg-surface-50-selected'
							: moment.signal === 'needs-you'
								? 'bg-warning-content'
								: 'text-fg-secondary bg-current',
					]}
					style:left={`${(moment.at / DURATION_MS) * 100}%`}
				></span>
			{/each}
		</div>
		<span class="text-fg-tertiary w-16 shrink-0 text-right text-sm tabular-nums">{clock}</span>
	</div>
</section>
