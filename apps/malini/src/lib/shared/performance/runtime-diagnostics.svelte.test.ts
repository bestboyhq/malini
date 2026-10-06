import { describe, expect, it, vi } from 'vitest';
import { PERFORMANCE_BUDGETS, RuntimeDiagnostics } from './runtime-diagnostics.svelte';

describe('RuntimeDiagnostics', () => {
	it('classifies completed spans against explicit budgets without retaining payload data', () => {
		let now = 100;
		const diagnostics = new RuntimeDiagnostics(() => now);
		const fast = diagnostics.start({ category: 'agent', label: 'Sending prompt', budgetMs: 100 });
		now = 180;
		fast.finish();
		const slow = diagnostics.start({
			category: 'extension',
			label: 'Starting extensions',
			budgetMs: 50,
		});
		now = 260;
		slow.finish();

		expect(
			diagnostics.recent.map(({ label, outcome, durationMs }) => ({ label, outcome, durationMs })),
		).toEqual([
			{ label: 'Sending prompt', outcome: 'ok', durationMs: 80 },
			{ label: 'Starting extensions', outcome: 'slow', durationMs: 80 },
		]);
		expect(JSON.stringify(diagnostics.snapshot())).not.toContain('super-secret user text');
	});

	it('finishes only the navigation matching the committed destination', () => {
		let now = 0;
		const diagnostics = new RuntimeDiagnostics(() => now);
		diagnostics.beginNavigation('/workstreams?agent=one', 'Opening workstream');
		now = 20;
		diagnostics.completeNavigation('/workstream/threads');
		expect(diagnostics.active).toHaveLength(1);
		now = 60;
		diagnostics.completeNavigation('/workstreams?agent=one');
		expect(diagnostics.active).toHaveLength(0);
		expect(diagnostics.recent.at(-1)?.durationMs).toBe(60);
		expect(diagnostics.recent.at(-1)?.target).toBe('/workstreams');
	});

	it('cancels a superseded navigation instead of reporting it as a freeze', () => {
		let now = 0;
		const diagnostics = new RuntimeDiagnostics(() => now);
		diagnostics.beginNavigation('/a', 'Opening A');
		now = 5;
		diagnostics.beginNavigation('/b', 'Opening B');
		expect(diagnostics.recent.at(-1)?.outcome).toBe('cancelled');
		diagnostics.completeNavigation('/b');
		expect(diagnostics.active).toHaveLength(0);
	});

	it('records visible main-thread lag and ignores background timer throttling', () => {
		vi.useFakeTimers();
		let now = 0;
		let visible = true;
		const diagnostics = new RuntimeDiagnostics(() => now);
		const stop = diagnostics.installMainThreadWatchdog({
			intervalMs: 100,
			lagThresholdMs: 200,
			isVisible: () => visible,
		});
		now = 450;
		vi.advanceTimersByTime(100);
		expect(diagnostics.freezes).toEqual([{ detectedAt: 450, durationMs: 350 }]);
		visible = false;
		now = 900;
		vi.advanceTimersByTime(100);
		expect(diagnostics.freezes).toHaveLength(1);
		stop();
		vi.useRealTimers();
	});

	it('normalizes invalid watchdog intervals and a stale disposer cannot stop its replacement', () => {
		vi.useFakeTimers();
		let now = 0;
		const diagnostics = new RuntimeDiagnostics(() => now);
		const intervalSpy = vi.spyOn(globalThis, 'setInterval');
		const staleStop = diagnostics.installMainThreadWatchdog({
			intervalMs: 0,
			lagThresholdMs: Number.NaN,
		});
		expect(intervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 250);

		const currentStop = diagnostics.installMainThreadWatchdog({
			intervalMs: 100,
			lagThresholdMs: 200,
			isVisible: () => true,
		});
		staleStop();
		now = 450;
		vi.advanceTimersByTime(100);
		expect(diagnostics.freezes).toEqual([{ detectedAt: 450, durationMs: 350 }]);

		currentStop();
		intervalSpy.mockRestore();
		vi.useRealTimers();
	});

	it('keeps budgets tight enough to surface regressions while heavy work stays async', () => {
		expect(PERFORMANCE_BUDGETS.navigationCommitMs).toBeLessThanOrEqual(200);
		expect(PERFORMANCE_BUDGETS.promptAcceptanceMs).toBeLessThanOrEqual(1_000);
		expect(PERFORMANCE_BUDGETS.mainThreadLagMs).toBeLessThanOrEqual(1_000);
	});

	it('bounds completed history and clears retained runtime state on reset', () => {
		let now = 0;
		const diagnostics = new RuntimeDiagnostics(() => now);

		for (let index = 0; index < 100; index += 1) {
			const handle = diagnostics.start({
				category: 'runtime',
				label: `Operation ${index}`,
				budgetMs: 10,
			});
			now += 1;
			handle.finish();
		}
		const active = diagnostics.start({
			category: 'runtime',
			label: 'Still active',
			budgetMs: 10,
		});

		expect(diagnostics.recent).toHaveLength(80);
		expect(diagnostics.recent[0]?.label).toBe('Operation 20');
		expect(diagnostics.active).toHaveLength(1);

		diagnostics.reset();
		expect(diagnostics.snapshot()).toEqual({ active: [], recent: [], freezes: [] });
		active.finish();
		expect(diagnostics.recent).toEqual([]);
	});

	it('bounds unfinished spans and retained diagnostic text', () => {
		const diagnostics = new RuntimeDiagnostics(() => 0);
		for (let index = 0; index < 60; index += 1) {
			diagnostics.start({
				category: 'runtime',
				label: `Operation ${index}${'x'.repeat(200)}`,
				budgetMs: 10,
				target: `workstream-${index}${'y'.repeat(300)}`,
			});
		}

		expect(diagnostics.active).toHaveLength(40);
		expect(diagnostics.recent).toHaveLength(20);
		expect(diagnostics.recent.every(({ outcome }) => outcome === 'cancelled')).toBe(true);
		expect(diagnostics.active.every(({ label }) => label.length <= 120)).toBe(true);
		expect(diagnostics.active.every(({ target }) => (target?.length ?? 0) <= 256)).toBe(true);
	});
});
