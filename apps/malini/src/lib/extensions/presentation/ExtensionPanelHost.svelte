<script lang="ts">
	import type { ExtensionPanelContext, ExtensionPanelRegistration } from '@malini/extension-api';

	import {
		ExtensionPanelHostController,
		type ExtensionPanelHostErrorHandler,
	} from './extension-panel-host';

	interface Props {
		panel: ExtensionPanelRegistration;
		context: ExtensionPanelContext;
		workstreamId: string;
		onerror?: ExtensionPanelHostErrorHandler;
	}

	let { panel, context, workstreamId, onerror = () => undefined }: Props = $props();
	let target: HTMLDivElement | null = $state(null);
	let renderRevision = 0;
	let renderState: 'waiting' | 'rendering' | 'ready' | 'error' = $state('waiting');
	let renderError: string | null = $state(null);
	const controller = new ExtensionPanelHostController((cause, failedPanel) => {
		if (failedPanel?.id === panel.id) {
			renderState = 'error';
			renderError = cause instanceof Error && cause.message ? cause.message : String(cause);
		}
		onerror(cause, failedPanel);
	});

	$effect(() => {
		const renderTarget = target;
		const renderPanel = panel;
		const renderContext = context;
		if (!renderTarget) return;

		const revision = ++renderRevision;
		renderState = 'rendering';
		renderError = null;
		void (async () => {
			await controller.render(renderTarget, renderPanel, renderContext);
			if (revision !== renderRevision) return;
			if (controller.isMounted(renderTarget, renderPanel)) {
				renderState = 'ready';
				return;
			}
			const settledRenderState: string = renderState;
			if (settledRenderState !== 'error') {
				renderState = 'error';
				renderError = 'The extension panel did not finish mounting.';
			}
		})();

		return () => {
			if (revision !== renderRevision) return;
			renderRevision += 1;
			renderState = 'waiting';
			renderError = null;
		};
	});

	$effect(() => () => {
		void controller.dispose();
	});
</script>

<div
	bind:this={target}
	class="min-h-0 min-w-0 flex-1 overflow-hidden"
	data-extension-panel-host
	data-panel-id={panel.id}
	data-navigation-workstream-id={workstreamId}
	data-navigation-panel-id={panel.id}
	data-navigation-ready={renderState === 'ready' ? 'true' : undefined}
	data-navigation-error={renderState === 'error' ? 'true' : undefined}
	data-navigation-error-message={renderState === 'error' ? renderError : undefined}
></div>
