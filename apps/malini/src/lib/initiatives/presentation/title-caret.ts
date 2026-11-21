export function caretAt(event: MouseEvent, title: string): number | null {
	if (event.detail === 0) return null;
	const position = document.caretPositionFromPoint(event.clientX, event.clientY);
	const inTitle =
		position?.offsetNode.nodeType === Node.TEXT_NODE && position.offsetNode.textContent === title;
	return inTitle ? position.offset : title.length;
}
