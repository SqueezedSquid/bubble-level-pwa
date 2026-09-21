/* Sensor math has no DOM or browser dependency, so it can be tested separately. */
(function (root) {
  "use strict";

  const DEG = 180 / Math.PI;
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  });
  const scale = (v, k) => ({ x: v.x * k, y: v.y * k, z: v.z * k });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const length = (v) => Math.hypot(v.x, v.y, v.z);
  const valid = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function unit(v) {
    if (!valid(v)) return null;
    const n = length(v);
    return n > 0.000001 ? scale(v, 1 / n) : null;
  }

  // Two perpendicular axes in the tangent plane of the zero gravity vector.
  // Face-up and face-down readings retain the same screen X/Y signs.
  function basis(reference) {
    const sign = reference.z < 0 ? -1 : 1;
    let u = unit(sub({ x: 1, y: 0, z: 0 }, scale(reference, reference.x)));
    let v;
    if (u && length(u) > 0 && Math.abs(reference.x) < 0.95) {
      v = scale(cross(reference, u), sign);
    } else {
      v = unit(sub({ x: 0, y: 1, z: 0 }, scale(reference, reference.y)));
      u = scale(cross(v, reference), sign);
    }
    return { u, v };
  }

  function angles(current, reference) {
    const { u, v } = basis(reference);
    const x = dot(current, u);
    const y = dot(current, v);
    const z = dot(current, reference);
    return {
      x: Math.atan2(x, z) * DEG,
      y: Math.atan2(y, z) * DEG,
      total: Math.atan2(Math.hypot(x, y), z) * DEG
    };
  }

  class LevelEngine {
    constructor() {
      this.bias = { x: 0, y: 0, z: 0 };
      this.zero = null;
      this.filtered = null;
      this.previousTime = null;
      this.last = null;
    }

    setBias(bias) {
      if (!valid(bias)) return false;
      this.bias = { x: bias.x, y: bias.y, z: bias.z };
      this.filtered = null;
      this.previousTime = null;
      this.zero = null; // Old ZERO was measured with another calibration.
      return true;
    }

    setZero(vector = this.filtered) {
      const normalized = unit(vector);
      if (!normalized) return false;
      this.zero = normalized;
      return true;
    }

    resetZero() { this.zero = null; }

    update(gravity, rotationRate, timeMs) {
      if (!valid(gravity) || !Number.isFinite(timeMs)) return null;
      const corrected = sub(gravity, this.bias);
      const magnitude = length(corrected);
      // No trustworthy orientation in free fall or with absent sensor data.
      if (magnitude < 1) return null;
      const raw = scale(corrected, 1 / magnitude);

      if (!this.filtered || this.previousTime === null) {
        this.filtered = raw;
      } else {
        const dt = clamp((timeMs - this.previousTime) / 1000, 0.001, 0.1);
        const error = Math.acos(clamp(dot(this.filtered, raw), -1, 1)) * DEG;
        const rate = rotationRate && [rotationRate.alpha, rotationRate.beta, rotationRate.gamma]
          .every(Number.isFinite)
          ? Math.hypot(rotationRate.alpha, rotationRate.beta, rotationRate.gamma)
          : 0;
        // Smooth small sensor noise strongly, but shorten the time constant
        // progressively as the phone's actual tilt changes. Gyro movement
        // alone (for example yaw on a table) must not move the bubble.
        const angleMotion = clamp((error - 0.12) / 0.55, 0, 1);
        const gyroMotion = clamp((rate - 10) / 35, 0, 1) *
          clamp((error - 0.05) / 0.25, 0, 1);
        const motion = Math.max(angleMotion, gyroMotion);
        const tau = 0.28 - 0.215 * motion;
        const alpha = 1 - Math.exp(-dt / tau);
        this.filtered = unit({
          x: this.filtered.x + alpha * (raw.x - this.filtered.x),
          y: this.filtered.y + alpha * (raw.y - this.filtered.y),
          z: this.filtered.z + alpha * (raw.z - this.filtered.z)
        }) || raw;
      }

      this.previousTime = timeMs;
      const reference = this.zero || { x: 0, y: 0, z: this.filtered.z < 0 ? -1 : 1 };
      this.last = {
        ...angles(this.filtered, reference),
        rawAngles: angles(raw, reference),
        raw,
        magnitude,
        filtered: this.filtered,
        motionWarning: Math.abs(magnitude - 9.81) > 1.2
      };
      return this.last;
    }

    measureCurrent() {
      if (!this.filtered) return null;
      const reference = this.zero || { x: 0, y: 0, z: this.filtered.z < 0 ? -1 : 1 };
      return angles(this.filtered, reference);
    }
  }

  const api = { LevelEngine, angles, unit };
  root.LevelMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
