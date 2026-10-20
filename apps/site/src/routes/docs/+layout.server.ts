import { navSections } from '$lib/content.server';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({ sections: navSections() });
