import { demoBridge } from './demo-bridge';
import { demoHandlers } from './demo-handlers';
import { passScrollToTheSite } from './demo-scroll';

window.malini = demoBridge(demoHandlers);
passScrollToTheSite();

await import('../src/main');
