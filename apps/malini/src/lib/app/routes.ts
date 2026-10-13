import type { RouteNode } from '$shared/router/hash-router.svelte';

export const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: '',
			layout: () => import('./presentation/layouts/WorkstreamsLayout.svelte'),
			page: () => import('./presentation/pages/RepositoriesPage.svelte'),
			children: [
				{
					segment: 'inbox',
					page: () => import('./presentation/pages/InboxPage.svelte'),
				},
				{
					segment: 'workstreams',
					children: [
						{
							segment: ':workstreamId',
							layout: () => import('./presentation/layouts/WorkstreamLayout.svelte'),
							page: () => import('./presentation/pages/WorkstreamPage.svelte'),
						},
					],
				},
			],
		},
		{
			segment: 'jobs',
			page: () => import('./presentation/pages/JobsPage.svelte'),
		},
		{
			segment: 'settings',
			layout: () => import('./presentation/layouts/SettingsLayout.svelte'),
			page: () => import('./presentation/pages/AgentSettingsPage.svelte'),
			children: [
				{
					segment: 'agent-access',
					page: () => import('./presentation/pages/AgentAccessSettingsPage.svelte'),
				},
				{
					segment: 'appearance',
					page: () => import('./presentation/pages/AppearanceSettingsPage.svelte'),
				},
				{
					segment: 'jobs',
					page: () => import('./presentation/pages/JobsSettingsPage.svelte'),
				},
				{
					segment: 'privacy',
					page: () => import('./presentation/pages/PrivacySettingsPage.svelte'),
				},
			],
		},
		{
			segment: 'dev',
			children: [
				{ segment: 'runtime', page: () => import('./presentation/pages/RuntimePage.svelte') },
			],
		},
	],
};

export const notFound = () => import('./presentation/pages/NotFoundPage.svelte');
