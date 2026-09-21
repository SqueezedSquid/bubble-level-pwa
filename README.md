# Libela — iPhone Bubble Level PWA

Static, dependency-free progressive web app. Upload all files and the `icons`
directory to the root of `SqueezedSquid/bubble-level-pwa` on the `main` branch.
GitHub Pages source: **Deploy from a branch → main → /(root)**.

Open `https://squeezedsquid.github.io/bubble-level-pwa/` in Safari, start the
sensor, then use Share → Add to Home Screen. Open once online and inspect
the offline status before testing with airplane mode. Sensor access can require
a fresh tap when a web app starts.

## Controls

- **ZERO**: stores the current normalized 3D gravity vector as the reference.
- **RESET**: clears ZERO and measures against a horizontal phone again.
- **Calibration**: records two stationary readings of the phone on the same
  surface, with a 180° in-plane rotation between them. It estimates X/Y sensor
  offsets; it cannot calibrate Z or certify 0.1° absolute accuracy.

The displayed angle has 0.1° resolution. Physical accuracy depends on the
sensor, motion, case, surface, and calibration. The gyro only selects a faster
filter time constant during movement; the tilt comes from the gravity-included
acceleration. The UI follows sensor events at browser rendering speed. The
debug panel shows actual event frequency and a two-second raw jitter estimate.

All assets are local. To publish future updates reliably, increment `CACHE`
in `sw.js` (for example `bubble-level-v2`) after changing app files. The current
service worker favors cached files, so a newly published version can require
closing and reopening the web app after its new service worker activates.

No server, third-party dependencies, npm, or Apple Developer Program needed.
