export function focusIsUnclaimed(): boolean {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return true;
	if (active.closest('[role="dialog"]')) return false;
	return !active.matches('input, textarea, select, [contenteditable], [role="textbox"]');
}

export function overlayIsOpen(): boolean {
	return document.querySelector('[data-dropdown-portal]:not([inert]), [aria-modal="true"]') !== null;
}
