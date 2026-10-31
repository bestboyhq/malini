# 0139 - Apps that agents launch composite without the GPU

Status: accepted

## Context

ADR 0125 left one quit stall unexplained: closing the window waits on a synchronous `DestroyCompositorFrameSink` call that the GPU process never answers.
It came back on pull request #122, in `composer-menus.spec.ts` on a CI macOS runner, after the test itself had passed.
The helper samples, symbolicated with Electron 44.4.0's Breakpad symbols, show the chain.
The browser main thread is in `NativeWidgetMacNSWindowHost::DestroyCompositor`, waiting on `FrameSinkManagerProxy::DestroyCompositorFrameSink`.
The GPU process's viz thread is in `~SkiaOutputSurfaceImpl`, waiting on the GPU main thread.
The GPU main thread is in `ui::CALayerTreeCoordinator::ApplyBackpressure`, which polls the previous frame's Metal shared events every millisecond with no timeout, and on the runner's virtual GPU one never signaled.
The main thread is blocked in native code, so no JavaScript watchdog in Malini can end the quit.

## Decision

`src/main/index.ts` calls `app.disableHardwareAcceleration()` before the app is ready when `MALINI_BACKGROUND_WINDOW=1`, beside hiding the Dock icon.
Background mode is only for apps that agents and the e2e harness launch (ADR 0007), so the user's own window keeps the GPU.
Chromium then composites in software, and no frame waits on a Metal fence.

## Consequences

Quitting an app that an agent or a test launched no longer depends on the GPU, in CI and on a developer's Mac alike.
E2e and agent screenshots render in software, which Rule 3 allows since no test asserts on rendering.
A bug that only shows with GPU compositing no longer reproduces in background mode; reproduce it in a foreground launch.
`tests/e2e/window.spec.ts` fails when a test run's app composites on the GPU.
