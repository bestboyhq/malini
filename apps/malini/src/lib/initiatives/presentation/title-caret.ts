export function caretAt(event: MouseEvent, title: string): number | null {
	if (event.detail === 0) return null;
	const position = document.caretPositionFromPoint(event.clientX, event.clientY);
	const inTitle =
		position?.offsetNode.nodeType === Node.TEXT_NODE && position.offsetNode.textContent === title;
	return inTitle ? position.offset : title.length;
}

export function stepTitle(event: KeyboardEvent): void {
	if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
	if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
	const title = event.currentTarget;
	if (!(title instanceof HTMLElement)) return;
	const titles = [
		...(title.closest('section') ?? document).querySelectorAll<HTMLElement>('[data-plan-title]'),
	];
	const next = titles[titles.indexOf(title) + (event.key === 'ArrowUp' ? -1 : 1)];
	if (!next) return;
	event.preventDefault();
	next.focus();
}
