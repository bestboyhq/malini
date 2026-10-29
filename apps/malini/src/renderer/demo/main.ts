import { demoBridge } from './demo-bridge';
import { demoHandlers } from './demo-handlers';
import { passScrollToTheSite } from './demo-scroll';
import { DEMO_PLAY } from './demo-play';
import { playHero } from './demo-script';
import { playTour } from './demo-tour';

window.malini = demoBridge(demoHandlers);
passScrollToTheSite();

await import('../src/main');

if (DEMO_PLAY === 'hero') void playHero();
if (DEMO_PLAY === 'tour') void playTour();
