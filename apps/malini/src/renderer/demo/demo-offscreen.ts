export function restVideosOffscreen(root: Element): void {
	const resting = new Set<HTMLVideoElement>();
	new IntersectionObserver(([entry]) => {
		if (entry?.isIntersecting) {
			for (const video of resting) void video.play().catch(() => {});
			resting.clear();
			return;
		}
		for (const video of root.querySelectorAll('video')) {
			if (video.paused) continue;
			resting.add(video);
			video.pause();
		}
	}).observe(root);
}
