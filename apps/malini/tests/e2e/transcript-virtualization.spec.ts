import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	listSessions,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const TURNS = 12;
const RUNS = '[data-testid="chat-message-list"] > li[data-run-id]';
const WHEEL_PX = 600;

function turnPrompt(turn: number): string {
	return `virtual turn ${turn} HEAVY:3`;
}

async function waitForTurn(page: Page, turn: number): Promise<void> {
	await expect(page.locator(RUNS)).toHaveCount(turn, { timeout: 60_000 });
	await expect(page.locator(RUNS).last()).toHaveAttribute('data-run-terminal', 'completed', {
		timeout: 60_000,
	});
}

type Probe = Readonly<{ top: number; text: string }>;

function probeAtCenter(scroller: Locator): Promise<Probe> {
	return scroller.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const marker = 'data-scroll-probe';
		for (const old of element.querySelectorAll(`[${marker}]`)) old.removeAttribute(marker);
		const hit = element.ownerDocument.elementFromPoint(box.left + 80, box.top + box.height / 2);
		const target = hit?.closest('p, li, pre, tr, h2, summary, [data-message-kind]') ?? hit;
		target?.setAttribute(marker, '');
		return {
			top: target?.getBoundingClientRect().top ?? Number.NaN,
			text: target?.textContent?.slice(0, 40) ?? '',
		};
	});
}

function settledProbeTop(scroller: Locator, from: number): Promise<number> {
	return scroller.evaluate(async (element, from) => {
		const probeTop = () =>
			element.querySelector('[data-scroll-probe]')?.getBoundingClientRect().top ?? Number.NaN;
		const view = element.ownerDocument.defaultView;
		const nextFrame = () => new Promise((resolve) => view?.requestAnimationFrame(resolve));
		const deadline = performance.now() + 5_000;
		let top = probeTop();
		let stillFrames = 0;
		while (performance.now() < deadline && (Object.is(top, from) || stillFrames < 6)) {
			await nextFrame();
			const next = probeTop();
			stillFrames = Object.is(next, top) ? stillFrames + 1 : 0;
			top = next;
		}
		return top;
	}, from);
}

test('a long chat scrolls to its first prompt without content jumping as older turns mount', async () => {
	test.setTimeout(600_000);
	const seeding = await launchMalini();
	let profile = '';
	let workstreamId = '';
	let sessionId = '';
	try {
		const { page } = seeding;
		const source = await createSourceRepo(seeding.root, 'virtual');
		({ workstreamId } = await seedWorkstream(page, source, 'e2e-virtual', 'Virtual chat'));
		await openWorkstream(page, workstreamId);
		for (let turn = 1; turn <= TURNS; turn += 1) {
			await sendPrompt(page, turnPrompt(turn));
			await waitForTurn(page, turn);
		}
		sessionId = (await listSessions(page, workstreamId))[0]?.id ?? '';
		profile = seeding.root;
		expectCleanConsole(seeding);
	} finally {
		await seeding.quit();
	}

	const app = await launchMalini({ profile });
	try {
		const { page } = app;
		await openWorkstream(page, workstreamId, sessionId);
		await waitForTurn(page, TURNS);
		const scroller = page.getByTestId('chat-message-scroller');
		await expect(page.getByText(turnPrompt(TURNS), { exact: true })).toBeVisible();
		await expect(page.getByText(turnPrompt(1), { exact: true })).toHaveCount(0);
		await expect(page.getByRole('listitem', { name: turnPrompt(1) })).toHaveCount(1);
		await captureFlow(app, 'transcript-virtualization-open');

		const box = await scroller.boundingBox();
		if (!box) throw new Error('the transcript scroller is not laid out');
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		const jumps: string[] = [];
		for (let wheel = 0; wheel < 2_000; wheel += 1) {
			const scrollTop = await scroller.evaluate((element) => element.scrollTop);
			if (scrollTop === 0) break;
			const before = await probeAtCenter(scroller);
			await page.mouse.wheel(0, -WHEEL_PX);
			const moved = (await settledProbeTop(scroller, before.top)) - before.top;
			const scrolledBy = Math.min(WHEEL_PX, scrollTop);
			if (Number.isFinite(moved) && Math.abs(moved - scrolledBy) > 2) {
				jumps.push(`"${before.text}" moved ${Math.round(moved)}px for a ${WHEEL_PX}px wheel`);
			}
		}

		await expect(page.getByText(turnPrompt(1), { exact: true })).toBeInViewport();
		expect(jumps, 'rows that jumped while older turns mounted above them').toEqual([]);
		await captureFlow(app, 'transcript-virtualization-top');

		await expect(page.getByText(turnPrompt(1), { exact: true })).toHaveCount(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
