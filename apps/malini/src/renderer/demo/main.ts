import { demoBridge } from './demo-bridge';
import { demoHandlers } from './demo-handlers';
import { passScrollToTheSite } from './demo-scroll';
import { playHero } from './demo-script';

window.malini = demoBridge(demoHandlers);
passScrollToTheSite();

await import('../src/main');

if (new URLSearchParams(location.search).get('play') === 'hero') void playHero();
