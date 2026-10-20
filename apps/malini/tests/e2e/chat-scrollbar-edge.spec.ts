import { expect, test, type Page } from '@playwright/test';
import {
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

type EdgeOwnership = Readonly<{
	scrollerReachesEdge: boolean;
	edgeScrollsChat: boolean;
	inspectorOnTop: boolean;
	transcriptClearsInspector: boolean;
}>;

function edgeOwnership(page: Page): Promise<EdgeOwnership> {
	return page.getByTestId('chat-message-scroller').evaluate((scroller) => {
		const doc = scroller.ownerDocument;
		const windowWidth = doc.documentElement.clientWidth;
		const list = doc.querySelector('[data-testid="chat-message-list"]');
		const inspector = doc.querySelector('[data-testid="extension-inspector-shell"]');
		if (!list || !inspector) throw new Error('the workstream is not on screen');
		const scrollerBox = scroller.getBoundingClientRect();
		const inspectorBox = inspector.getBoundingClientRect();
		const edgeHit = doc.elementFromPoint(windowWidth - 2, scrollerBox.top + scrollerBox.height / 2);
		const inspectorHit = doc.elementFromPoint(
			inspectorBox.left + inspectorBox.width / 2,
			inspectorBox.top + 16,
		);
		return {
			scrollerReachesEdge: Math.round(scrollerBox.right) === windowWidth,
			edgeScrollsChat: edgeHit !== null && scroller.contains(edgeHit),
			inspectorOnTop: inspectorHit !== null && inspector.contains(inspectorHit),
			transcriptClearsInspector: list.getBoundingClientRect().right <= inspectorBox.left,
		};
	});
}

const OWNED_EDGE: EdgeOwnership = {
	scrollerReachesEdge: true,
	edgeScrollsChat: true,
	inspectorOnTop: true,
	transcriptClearsInspector: true,
};

test('the chat scrolls from the window edge while the inspector stays on top of it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-chat-scrollbar-edge-ws',
			'Chat scrollbar edge workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Reach the edge');
		await expectAssistantReply(page);
		const resize = (width: number): Promise<void> =>
			electronApp.evaluate(
				({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setContentSize(width, 800),
				width,
			);
		const inspector = page.getByTestId('extension-inspector-shell');

		await resize(1280);
		await expect(inspector).toHaveAttribute('data-inspector-drawer-open', 'true');
		await expect.poll(() => edgeOwnership(page)).toEqual(OWNED_EDGE);

		await resize(900);
		await expect(inspector).toHaveAttribute('data-inspector-drawer-open', 'false');
		await expect.poll(() => edgeOwnership(page)).toEqual(OWNED_EDGE);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
