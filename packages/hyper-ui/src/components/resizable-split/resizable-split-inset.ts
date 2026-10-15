import { createContext } from 'svelte';

export type ResizableSplitInset = Readonly<{ secondarySize: number }>;

const NO_INSET: ResizableSplitInset = { secondarySize: 0 };
const [getInset, setInset, hasInset] = createContext<ResizableSplitInset>();

export const setResizableSplitInset = setInset;

export function resizableSplitInset(): ResizableSplitInset {
	return hasInset() ? getInset() : NO_INSET;
}
