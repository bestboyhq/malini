export const ROWS_MESSAGE = 'malini-demo:rows';

const ROWS =
	'[data-message-kind="assistant"], [data-message-kind="tool"], [data-message-kind="bash"]';

export function reportRows(): void {
	if (parent === window) return;
	let sent = '';
	let seen = true;
	let placed = false;
	new IntersectionObserver(([entry]) => (seen = entry?.isIntersecting ?? true)).observe(
		document.documentElement,
	);
	// ponytail: polls row boxes every 300 ms on screen; a ResizeObserver on each row if this ever costs
	setInterval(() => {
		if (placed && !seen) return;
		const rows = [...document.querySelectorAll(ROWS)].map((row) => {
			const { x, y, width, height } = row.getBoundingClientRect();
			return { x, y, width, height };
		});
		const next = JSON.stringify(rows);
		if (next === sent) return;
		sent = next;
		placed = rows.length > 0;
		parent.postMessage({ type: ROWS_MESSAGE, rows }, location.origin);
	}, 300);
}
