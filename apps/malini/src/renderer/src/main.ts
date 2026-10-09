import { mount } from 'svelte';
import { installLoopingAnimationSync } from '$hyper-ui/motion/looping-animations';
import App from '$lib/app/presentation/App.svelte';
import { optionalPublicEnv } from '$shared/env/public-env';
import { installRendererErrorCapture } from '$shared/errors/renderer-error-sink';
import { installToastRecording } from '$shared/errors/toast-recorder';
import { requestFakePlatform } from '$shared/port/platform';
import { migrateStorageKeys } from '$shared/storage/migrate-storage-keys';
import './app.css';

if (optionalPublicEnv('PUBLIC_PLATFORM', '') === 'fake') requestFakePlatform();
installRendererErrorCapture();
installToastRecording();
installLoopingAnimationSync();
migrateStorageKeys();

const target = document.getElementById('app');
if (!target) throw new Error('renderer root #app is missing from index.html');

mount(App, { target });
