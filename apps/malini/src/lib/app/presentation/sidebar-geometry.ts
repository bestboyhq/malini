const mounted: HTMLElement[] = [];
const publishers = new Map<HTMLElement, () => void>();

const LEFT_PROPERTY = '--shell-sidebar-left';
const WIDTH_PROPERTY = '--shell-sidebar-width';

function currentOwner(): HTMLElement | null {
	return mounted.at(-1) ?? null;
}

function clearGeometry(): void {
	const root = document.documentElement;
	root.style.removeProperty(LEFT_PROPERTY);
	root.style.removeProperty(WIDTH_PROPERTY);
}

function publishOwnerGeometry(): void {
	const owner = currentOwner();
	if (!owner) {
		clearGeometry();
		return;
	}
	publishers.get(owner)?.();
}

export function sidebarGeometry(node: HTMLElement): { destroy(): void } {
	if (typeof window === 'undefined') {
		return { destroy: () => undefined };
	}

	const publish = (): void => {
		if (currentOwner() !== node) return;
		const rect = node.getBoundingClientRect();
		const root = document.documentElement;
		root.style.setProperty(LEFT_PROPERTY, `${Math.round(rect.left)}px`);
		root.style.setProperty(WIDTH_PROPERTY, `${Math.round(rect.width)}px`);
	};

	mounted.push(node);
	publishers.set(node, publish);
	publish();

	const observer = new ResizeObserver(publish);
	observer.observe(node);
	window.addEventListener('resize', publish);

	return {
		destroy(): void {
			observer.disconnect();
			window.removeEventListener('resize', publish);
			publishers.delete(node);
			const index = mounted.indexOf(node);
			if (index >= 0) mounted.splice(index, 1);
			publishOwnerGeometry();
		},
	};
}
