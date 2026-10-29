import { goto } from '$shared/router/navigation';
import { workstreamHref, workstreamIdFromPathname } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';

import { browserService } from '../../infrastructure/services/browser.service';

export { revealOpenedThreadHook };

function revealOpenedThreadHook(): () => void {
	return browserService.onThreadOpened(({ workstreamId, sessionId }) => {
		if (workstreamIdFromPathname(page.url.pathname) !== workstreamId) {
			void goto(workstreamHref(workstreamId, { agentSessionId: sessionId }));
			return;
		}
		const next = new URL(page.url);
		next.searchParams.set('agent', sessionId);
		void goto(`${next.pathname}${next.search}`, { noScroll: true });
	});
}
