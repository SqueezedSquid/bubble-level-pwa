(function (global) {
  "use strict";

  const TO_DEGREES = 180 / Math.PI;

  function fromGravity(gravity) {
    if (
      !gravity ||
      !Number.isFinite(gravity.x) ||
      !Number.isFinite(gravity.y) ||
      !Number.isFinite(gravity.z)
    ) {
      return null;
    }

    const magnitude = Math.hypot(
      gravity.x,
      gravity.y,
      gravity.z
    );

    if (magnitude < 0.000001) return null;

    // Enotski 3D vektor: njegova dolžina je 1.
    const x = gravity.x / magnitude;
    const y = gravity.y / magnitude;
    const z = gravity.z / magnitude;

    // Nagib vzdolž osi zaslona; rezultat posamezne osi je od −90° do +90°.
    const xDegrees = Math.atan2(
      x,
      Math.hypot(y, z)
    ) * TO_DEGREES;

    const yDegrees = Math.atan2(
      y,
      Math.hypot(x, z)
    ) * TO_DEGREES;

    // Skupni odklon ravnine telefona od vodoravnice: 0° do 90°.
    const totalDegrees = Math.atan2(
      Math.hypot(x, y),
      Math.abs(z)
    ) * TO_DEGREES;

    return {
      vector: { x, y, z },
      magnitude,
      xDegrees,
      yDegrees,
      totalDegrees
    };
  }

  global.LevelMeasurement = { fromGravity };
})(window);
