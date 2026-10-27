import type { GithubReach } from '$contract/github-failure';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';

class GithubReachAggregate {
	reach: GithubReach = $state('ok');

	watch(): () => void {
		let heard = false;
		const stop = githubService.onReachChanged((reach) => {
			heard = true;
			this.reach = reach;
		});
		void (async () => {
			try {
				const reach = await githubService.reach();
				if (!heard) this.reach = reach;
			} catch (error) {
				console.error('[malini github] could not read whether GitHub answers', error);
			}
		})();
		return stop;
	}
}

export const githubReachAggregate = new GithubReachAggregate();
