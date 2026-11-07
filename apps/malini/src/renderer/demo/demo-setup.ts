export const ROWS_MESSAGE = 'malini-demo:rows';

const ROWS =
	'[data-message-kind="assistant"], [data-message-kind="tool"], [data-message-kind="bash"]';

export function reportRows(): void {
	if (parent === window) return;
	let sent = '';
	// ponytail: polls row boxes every 300 ms; a ResizeObserver on each row if this ever costs
	setInterval(() => {
		const rows = [...document.querySelectorAll(ROWS)].map((row) => {
			const { x, y, width, height } = row.getBoundingClientRect();
			return { x, y, width, height };
		});
		const next = JSON.stringify(rows);
		if (next === sent) return;
		sent = next;
		parent.postMessage({ type: ROWS_MESSAGE, rows }, location.origin);
	}, 300);
}
