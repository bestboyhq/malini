import { mount } from 'svelte';
import '../src/app.css';
import { demoBridge } from './demo-bridge';
import { demoHandlers } from './demo-handlers';
import { playOf } from './demo-attract';
import { passScrollToTheSite } from './demo-scroll';
import DemoReport from './DemoReport.svelte';

window.malini = demoBridge(demoHandlers);
passScrollToTheSite();

const target = document.getElementById('app');
if (!target) throw new Error('the demo card needs #app');

mount(DemoReport, {
	target,
	props: {
		workstreamId: window.location.hash.slice(1),
		play: playOf(new URLSearchParams(window.location.search).get('play')),
	},
});
