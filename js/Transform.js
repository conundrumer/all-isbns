/**
 * Calculate midpoint between two points
 * @param {[number, number]} p1
 * @param {[number, number]} p2
 * @returns {[number, number]}
 */
function midpoint([x1, y1], [x2, y2]) {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

/**
 * Calculate distance between two points
 * @param {[number, number]} p1
 * @param {[number, number]} p2
 * @returns {number}
 */
function distance([x1, y1], [x2, y2]) {
  return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * Calculate translation to move from one point to another
 * @param {[number, number]} initial Point to move from
 * @param {[number, number]} current Point to move to
 * @returns {{dx: number, dy: number}} Translation vector
 */
export function singleAnchorTransform([x0, y0], [x1, y1]) {
  return {
    dx: x1 - x0,
    dy: y1 - y0
  };
}

/**
 * Calculate transform from two anchor points
 * @param {[number, number]} p0 First initial position
 * @param {[number, number]} q0 Second initial position
 * @param {[number, number]} p1 First current position
 * @param {[number, number]} q1 Second current position
 * @param {number} minScale Minimum allowed scale
 * @param {number} maxScale Maximum allowed scale
 * @returns {{ x: number, y: number, scale: number }} New absolute transform
 */
export function doubleAnchorTransform(p0, q0, p1, q1, minScale, maxScale) {
  const [mx0, my0] = midpoint(p0, q0);
  const [mx1, my1] = midpoint(p1, q1);

  const d0 = distance(p0, q0);
  const d1 = distance(p1, q1);

  const scale = Math.min(Math.max(d1 / d0, minScale), maxScale);

  return {
    x: mx1 - mx0 * scale,
    y: my1 - my0 * scale,
    scale
  };
}

/**
 * Convert screen coordinates to content coordinates
 * @param {[number, number]} screenPoint Point in screen space
 * @param {{ x: number, y: number, scale: number, width: number, height: number }} transform Current transform
 * @returns {[number, number]} Point in content space
 */
export function screenToContent([px, py], { x, y, scale, width, height }) {
  return [
    (px - x - width / 2) / scale,
    (py - y - height / 2) / scale
  ];
}

/**
 * Convert content coordinates to screen coordinates
 * @param {[number, number]} contentPoint Point in content space
 * @param {{ x: number, y: number, scale: number, width: number, height: number }} transform Current transform
 * @returns {[number, number]} Point in screen space
 */
export function contentToScreen([px, py], { x, y, scale, width, height }) {
  return [
    px * scale + x + width / 2,
    py * scale + y + height / 2
  ];
}