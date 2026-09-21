(function () {
  "use strict";

  const engine = new LevelMath.LevelEngine();
  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    "start", "status", "mode", "bubble", "dial", "tilt-x", "tilt-y",
    "tilt-total", "zero", "reset", "hz", "interval", "api-interval",
    "jitter", "gravity", "magnitude", "orientation", "rotation", "bias",
    "offline", "calibrate", "clear-cal", "cal-status", "feel"
  ].map((id) => [id, $(id)]));
  ui.apiInterval = ui["api-interval"];
  ui.calStatus = ui["cal-status"];
  ui.clearCal = ui["clear-cal"];

  const fmt = (number, digits = 1) =>
    Number.isFinite(number) ? number.toFixed(digits).replace(".", ",") : "—";
  const storage = {
    read(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional persistence. */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* Optional persistence. */ }
    }
  };

  const savedBias = storage.read("level-bias-v1");
  if (savedBias && Math.abs(savedBias.x) < 1 && Math.abs(savedBias.y) < 1 && savedBias.z === 0) {
    engine.setBias(savedBias);
  }
  const savedZero = storage.read("level-zero-v1");
  if (savedZero) engine.setZero(savedZero);

  const feelModes = {
    1: { frequency: 3, damping: 0.96 },
    2: { frequency: 4.1, damping: 0.95 },
    3: { frequency: 5.2, damping: 0.94 },
    4: { frequency: 6.5, damping: 0.93 },
    5: { frequency: 8.2, damping: 0.92 },
    6: { frequency: 10.5, damping: 0.9 },
    7: { frequency: 13, damping: 0.85 },
    8: { frequency: 17, damping: 0.8 },
    9: { frequency: 22, damping: 0.75 },
    10: { frequency: 28, damping: 0.7 }
  };
  const previousFeel = { calm: "6", balanced: "8", quick: "10" };
  const savedFeel = storage.read("level-feel-v2") ?? previousFeel[storage.read("level-feel-v1")];
  if (ui.feel) {
    ui.feel.value = Object.prototype.hasOwnProperty.call(feelModes, savedFeel) ? savedFeel : "6";
  }

  let started = false;
  let lastMotionAt = 0;
  let previousEventAt = 0;
  let lastDebugAt = 0;
  let renderScheduled = false;
  let latestGravity = null;
  let latestRotation = null;
  let latestOrientation = null;
  let latestApiInterval = null;
  let lastInterval = null;
  let calibrationA = null;
  let capture = null;
  const bubbleMotion = { x: 0, y: 0, vx: 0, vy: 0, lastFrame: null };
  const times = [];
  const noise = [];

  function setStatus(message) {
    if (ui.status.textContent !== message) ui.status.textContent = message;
  }

  function saveZero() {
    if (engine.zero) storage.write("level-zero-v1", engine.zero);
    else storage.remove("level-zero-v1");
  }

  function refreshControls() {
    ui.mode.textContent = engine.zero ? "ZERO AKTIVEN" : "STANDARD";
    ui.mode.classList.toggle("is-zero", Boolean(engine.zero));
    ui.zero.disabled = !started || !engine.filtered || Boolean(capture);
    ui.reset.disabled = !engine.zero;
    ui.calibrate.disabled = !started || !engine.filtered || Boolean(capture);
    ui.clearCal.disabled = engine.bias.x === 0 && engine.bias.y === 0;
  }

  function standardDeviation(values) {
    if (values.length < 2) return NaN;
    const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
    return Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length);
  }

  function meanVector(samples) {
    const sum = samples.reduce((a, v) => ({
      x: a.x + v.x, y: a.y + v.y, z: a.z + v.z
    }), { x: 0, y: 0, z: 0 });
    return { x: sum.x / samples.length, y: sum.y / samples.length, z: sum.z / samples.length };
  }

  function finishCapture() {
    const { samples, step } = capture;
    capture = null;
    const mean = samples.length ? meanVector(samples) : null;
    const scatter = mean ? Math.sqrt(samples.reduce((sum, v) =>
      sum + (v.x - mean.x) ** 2 + (v.y - mean.y) ** 2 + (v.z - mean.z) ** 2, 0
    ) / samples.length) : Infinity;

    if (samples.length < 20 || scatter > 0.22) {
      ui.calStatus.textContent = "Telefon se je med zajemom premikal. Počakaj, da miruje, in ponovi.";
      refreshControls();
      return;
    }

    if (step === "A") {
      calibrationA = mean;
      ui.calibrate.textContent = "Zajemi položaj B";
      ui.calStatus.textContent = "A je zajet. Obrni telefon za 180° na isti površini, počakaj in zajemi B.";
    } else {
      if (Math.abs(calibrationA.z - mean.z) > 0.5) {
        ui.calStatus.textContent = "Položaja nista na isti strani ravnine. Ponovi položaj B.";
        refreshControls();
        return;
      }
      const bias = { x: (calibrationA.x + mean.x) / 2, y: (calibrationA.y + mean.y) / 2, z: 0 };
      if (Math.abs(bias.x) > 1 || Math.abs(bias.y) > 1) {
        ui.calStatus.textContent = "Odmik je prevelik. Začni znova na isti površini.";
        calibrationA = null;
        ui.calibrate.textContent = "Zajemi položaj A";
        refreshControls();
        return;
      }
      engine.setBias(bias);
      storage.write("level-bias-v1", bias);
      saveZero();
      calibrationA = null;
      ui.calibrate.textContent = "Zajemi položaj A";
      ui.calStatus.textContent = "Kalibracija shranjena. ZERO je ponastavljen.";
      noise.length = 0;
    }
    refreshControls();
    scheduleRender();
  }

  function onMotion(event) {
    const g = event.accelerationIncludingGravity;
    const now = performance.now();
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y) || !Number.isFinite(g.z)) {
      setStatus("Dogodki prihajajo, podatki o težnosti pa niso na voljo.");
      return;
    }

    latestGravity = { x: g.x, y: g.y, z: g.z };
    latestRotation = event.rotationRate;
    latestApiInterval = event.interval;
    lastInterval = previousEventAt ? now - previousEventAt : null;
    previousEventAt = now;
    lastMotionAt = now;

    const reading = engine.update(latestGravity, latestRotation, now);
    if (!reading) {
      setStatus("Podatek senzorja ni primeren za merjenje.");
      return;
    }

    times.push(now);
    while (times.length > 1 && times[0] < now - 2000) times.shift();
    noise.push({ t: now, x: reading.rawAngles.x, y: reading.rawAngles.y });
    while (noise.length > 1 && noise[0].t < now - 2000) noise.shift();

    if (capture) {
      capture.samples.push(latestGravity);
      if (now - capture.startedAt >= 1500) finishCapture();
    }

    setStatus(reading.motionWarning
      ? "Telefon se premika ali pospešuje; trenutni nagib je lahko manj zanesljiv."
      : "Merjenje deluje.");
    scheduleRender();
  }

  function onOrientation(event) {
    latestOrientation = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
  }

  function renderDebug() {
    const now = performance.now();
    if (now - lastDebugAt < 250) return;
    lastDebugAt = now;
    const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
    ui.hz.textContent = span > 0 ? `${fmt((times.length - 1) * 1000 / span)} Hz` : "—";
    ui.interval.textContent = `${fmt(lastInterval)} ms`;
    ui.apiInterval.textContent = `${fmt(latestApiInterval)} ms`;
    ui.jitter.textContent = noise.length > 1
      ? `${fmt(standardDeviation(noise.map(v => v.x)), 3)}° / ${fmt(standardDeviation(noise.map(v => v.y)), 3)}°`
      : "—";
    if (latestGravity) {
      ui.gravity.textContent = [latestGravity.x, latestGravity.y, latestGravity.z]
        .map(v => fmt(v, 3)).join(" / ") + " m/s²";
    }
    ui.magnitude.textContent = `${fmt(engine.last?.magnitude, 3)} m/s²`;
    ui.orientation.textContent = latestOrientation
      ? [latestOrientation.alpha, latestOrientation.beta, latestOrientation.gamma].map(v => fmt(v)).join(" / ") + "°"
      : "—";
    ui.rotation.textContent = latestRotation
      ? [latestRotation.alpha, latestRotation.beta, latestRotation.gamma].map(v => fmt(v)).join(" / ") + " °/s"
      : "—";
    ui.bias.textContent = `${fmt(engine.bias.x, 3)} / ${fmt(engine.bias.y, 3)} m/s²`;
  }

  function springStep(position, velocity, target, dt) {
    // Damped spring: a little inertia and overshoot, with no permanent lag.
    const { frequency, damping } = feelModes[ui.feel?.value] || feelModes[6];
    const decayRate = damping * frequency;
    const oscillation = frequency * Math.sqrt(1 - damping * damping);
    const error = position - target;
    const decay = Math.exp(-decayRate * dt);
    const sine = Math.sin(oscillation * dt);
    const cosine = Math.cos(oscillation * dt);
    const nextPosition = target + decay *
      (error * cosine + (velocity + decayRate * error) / oscillation * sine);
    const nextVelocity = decay *
      (velocity * cosine - (decayRate * velocity + frequency * frequency * error) / oscillation * sine);
    return [nextPosition, nextVelocity];
  }

  function render(frameTime) {
    renderScheduled = false;
    const reading = engine.measureCurrent();
    if (!reading) return;
    ui["tilt-x"].textContent = `${fmt(reading.x)}°`;
    ui["tilt-y"].textContent = `${fmt(reading.y)}°`;
    ui["tilt-total"].textContent = `${fmt(reading.total)}°`;

    // Gravity points toward the low edge; the bubble floats in the opposite direction.
    // The spring gives the bubble visual mass; numeric readings use the sensor directly.
    const limit = (ui.dial.clientWidth - ui.bubble.clientWidth) / 2 - 9;
    const pxPerDegree = limit / 8;
    const targetX = Math.max(-limit, Math.min(limit, -reading.x * pxPerDegree));
    const targetY = Math.max(-limit, Math.min(limit, reading.y * pxPerDegree));
    const now = Number.isFinite(frameTime) ? frameTime : performance.now();
    if (bubbleMotion.lastFrame === null) {
      bubbleMotion.x = targetX;
      bubbleMotion.y = targetY;
    } else {
      const dt = Math.max(0, Math.min((now - bubbleMotion.lastFrame) / 1000, 0.06));
      [bubbleMotion.x, bubbleMotion.vx] = springStep(bubbleMotion.x, bubbleMotion.vx, targetX, dt);
      [bubbleMotion.y, bubbleMotion.vy] = springStep(bubbleMotion.y, bubbleMotion.vy, targetY, dt);
    }
    bubbleMotion.lastFrame = now;
    for (const axis of ["x", "y"]) {
      const velocity = axis === "x" ? "vx" : "vy";
      if (bubbleMotion[axis] > limit) {
        bubbleMotion[axis] = limit;
        bubbleMotion[velocity] = Math.min(0, bubbleMotion[velocity]);
      } else if (bubbleMotion[axis] < -limit) {
        bubbleMotion[axis] = -limit;
        bubbleMotion[velocity] = Math.max(0, bubbleMotion[velocity]);
      }
    }
    const dx = Math.round(bubbleMotion.x);
    const dy = Math.round(bubbleMotion.y);
    ui.bubble.style.transform = `translate3d(calc(-50% + ${dx}px), calc(-50% + ${dy}px), 0)`;
    if (document.querySelector(".debug").open) renderDebug();
    refreshControls();
    if (Math.abs(bubbleMotion.x - targetX) > 0.25 ||
        Math.abs(bubbleMotion.y - targetY) > 0.25 ||
        Math.abs(bubbleMotion.vx) > 1 || Math.abs(bubbleMotion.vy) > 1) {
      scheduleRender();
    } else {
      bubbleMotion.x = targetX;
      bubbleMotion.y = targetY;
      bubbleMotion.vx = 0;
      bubbleMotion.vy = 0;
    }
  }

  function scheduleRender() {
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(render);
    }
  }

  ui.start.addEventListener("click", async () => {
    if (!window.isSecureContext || !window.DeviceMotionEvent) {
      setStatus("Senzor zahteva podprt brskalnik in povezavo HTTPS.");
      return;
    }
    ui.start.disabled = true;
    setStatus("Čakam na dovoljenje za senzor …");
    try {
      // Both permission requests are initiated synchronously within the tap.
      const motion = typeof DeviceMotionEvent.requestPermission === "function"
        ? DeviceMotionEvent.requestPermission() : Promise.resolve("not-required");
      const orientation = typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
        ? DeviceOrientationEvent.requestPermission() : Promise.resolve("not-required");
      const [m, o] = await Promise.allSettled([motion, orientation]);
      if (m.status === "rejected" || m.value === "denied") {
        setStatus("Dovoljenje za senzor gibanja ni odobreno.");
        ui.start.disabled = false;
        return;
      }
      window.addEventListener("devicemotion", onMotion);
      if (o.status === "fulfilled" && o.value !== "denied") {
        window.addEventListener("deviceorientation", onOrientation);
      }
      started = true;
      ui.start.hidden = true;
      setStatus("Čakam na prve podatke senzorja …");
      refreshControls();
    } catch (error) {
      setStatus(`Dovoljenje ni uspelo: ${error.message}`);
      ui.start.disabled = false;
    }
  });

  ui.zero.addEventListener("click", () => {
    if (!engine.setZero()) return;
    saveZero();
    noise.length = 0;
    scheduleRender();
  });
  ui.reset.addEventListener("click", () => {
    engine.resetZero();
    saveZero();
    noise.length = 0;
    scheduleRender();
  });
  ui.calibrate.addEventListener("click", () => {
    capture = { step: calibrationA ? "B" : "A", samples: [], startedAt: performance.now() };
    ui.calStatus.textContent = `Zajemam položaj ${capture.step}: telefon naj miruje približno 1,5 sekunde …`;
    refreshControls();
  });
  ui.clearCal.addEventListener("click", () => {
    engine.setBias({ x: 0, y: 0, z: 0 });
    storage.remove("level-bias-v1");
    saveZero();
    calibrationA = null;
    ui.calibrate.textContent = "Zajemi položaj A";
    ui.calStatus.textContent = "Kalibracija in ZERO sta ponastavljena.";
    noise.length = 0;
    refreshControls();
  });
  if (ui.feel) {
    ui.feel.addEventListener("change", () => {
      storage.write("level-feel-v2", ui.feel.value);
      scheduleRender();
    });
  }

  setInterval(() => {
    if (started && performance.now() - lastMotionAt > 3000) {
      setStatus("Senzor ne pošilja podatkov. Vrni se v aplikacijo ali jo odpri znova.");
    }
  }, 3000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => { ui.offline.textContent = "Pripravljen; preveri v letalskem načinu"; })
      .catch(() => { ui.offline.textContent = "Shranjevanje za offline ni uspelo"; });
  } else {
    ui.offline.textContent = "Ta brskalnik ne podpira offline shranjevanja";
  }
  refreshControls();
})();
