import { createContext } from 'svelte';

export type ResizableSplitInset = Readonly<{ extent: number; secondarySize: number }>;

const NO_INSET: ResizableSplitInset = { extent: 0, secondarySize: 0 };
const [getInset, setInset, hasInset] = createContext<ResizableSplitInset>();

export const setResizableSplitInset = setInset;

export function resizableSplitInset(): ResizableSplitInset {
	return hasInset() ? getInset() : NO_INSET;
}
