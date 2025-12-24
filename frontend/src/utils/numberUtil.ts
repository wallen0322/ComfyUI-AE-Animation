/**
 * Number Utility Functions
 * 
 * Common number manipulation and boundary protection functions
 * used across the application for consistent numerical handling.
 */

/**
 * Clamp a number between min and max values
 * @param value - The value to clamp
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Clamp FOV (Field of View) to valid range
 * @param fov - The FOV value in degrees
 * @returns Clamped FOV between 10 and 170 degrees
 */
export function clampFov(fov: number): number {
  return clamp(fov, 10, 170)
}

/**
 * Clamp camera Z position to valid range
 * @param z - The Z position value
 * @returns Clamped Z position >= 100
 */
export function clampCamPosZ(z: number): number {
  return Math.max(100, z)
}

/**
 * Calculate camera Z scale based on position
 * The closer the camera (smaller Z), the larger the scale (zoom in)
 * @param camPosZ - Camera Z position
 * @returns Scale factor between 0.1 and 10
 */
export function calculateCameraZScale(camPosZ: number): number {
  return clamp(1000 / Math.max(100, camPosZ), 0.1, 10)
}

/**
 * Calculate depth scale based on layer Z position
 * Used for parallax effect - layers further away appear smaller
 * @param z - Layer Z position
 * @returns Depth scale factor
 */
export function calculateDepthScale(z: number): number {
  return 1 / Math.max(0.1, 1 + z * 0.001)
}

/**
 * Clamp image dimension to valid range
 * Ensures width/height are at least 1 pixel
 * @param value - The dimension value
 * @returns Clamped dimension >= 1
 */
export function clampImageDimension(value: number): number {
  return Math.max(1, value)
}

/**
 * Clamp and floor image dimension
 * Ensures width/height are integers >= 1
 * @param value - The dimension value
 * @returns Clamped and floored dimension >= 1
 */
export function clampAndFloorDimension(value: number): number {
  return Math.max(1, Math.floor(value))
}

/**
 * Clamp zoom ratio to valid range
 * @param ratio - The zoom ratio
 * @returns Clamped zoom ratio between 0.1 and 10
 */
export function clampZoomRatio(ratio: number): number {
  return clamp(ratio, 0.1, 10)
}

/**
 * Clamp layer scale to valid range
 * @param scale - The layer scale value
 * @returns Clamped scale between 0.1 and 5
 */
export function clampLayerScale(scale: number): number {
  return clamp(scale, 0.1, 5)
}

/**
 * Clamp FPS to valid range
 * @param fps - The FPS value
 * @returns Clamped FPS >= 1
 */
export function clampFps(fps: number): number {
  return Math.max(1, fps)
}

/**
 * Clamp total frames to valid range
 * @param frames - The total frames value
 * @returns Clamped total frames >= 1
 */
export function clampTotalFrames(frames: number): number {
  return Math.max(1, Math.round(frames))
}

/**
 * Clamp opacity to valid range
 * @param opacity - The opacity value
 * @returns Clamped opacity between 0 and 1
 */
export function clampOpacity(opacity: number): number {
  return clamp(opacity, 0, 1)
}

/**
 * Clamp rotation to valid range
 * @param rotation - The rotation value in degrees
 * @returns Clamped rotation between -180 and 180
 */
export function clampRotation(rotation: number): number {
  return clamp(rotation, -180, 180)
}

/**
 * Clamp brush size to valid range
 * @param size - The brush size
 * @returns Clamped brush size >= 1
 */
export function clampBrushSize(size: number): number {
  return Math.max(1, size)
}

/**
 * Clamp delta value for smooth interaction
 * Limits large delta values to prevent sudden jumps
 * @param delta - The delta value
 * @param maxDelta - Maximum allowed delta (default: 100)
 * @returns Clamped delta value
 */
export function clampDelta(delta: number, maxDelta: number = 100): number {
  return clamp(delta, -maxDelta, maxDelta)
}

/**
 * Safe division with protection against division by zero
 * @param numerator - The numerator
 * @param denominator - The denominator
 * @param fallback - Fallback value if denominator is zero (default: 0)
 * @returns Division result or fallback
 */
export function safeDivide(numerator: number, denominator: number, fallback: number = 0): number {
  return Math.abs(denominator) < Number.EPSILON ? fallback : numerator / denominator
}

/**
 * Lerp (Linear Interpolation) between two values
 * @param start - Start value
 * @param end - End value
 * @param t - Interpolation factor (0-1)
 * @returns Interpolated value
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * clamp(t, 0, 1)
}

/**
 * Map a value from one range to another
 * @param value - Value to map
 * @param inMin - Input range minimum
 * @param inMax - Input range maximum
 * @param outMin - Output range minimum
 * @param outMax - Output range maximum
 * @returns Mapped value
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  const clampedValue = clamp(value, inMin, inMax)
  const normalized = (clampedValue - inMin) / (inMax - inMin)
  return lerp(outMin, outMax, normalized)
}

/**
 * Convert degrees to radians
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Convert radians to degrees
 * @param radians - Angle in radians
 * @returns Angle in degrees
 */
export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI
}

/**
 * Normalize angle to 0-360 range
 * @param angle - Angle in degrees
 * @returns Normalized angle
 */
export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}

/**
 * Check if two numbers are approximately equal
 * @param a - First number
 * @param b - Second number
 * @param epsilon - Tolerance (default: Number.EPSILON)
 * @returns True if numbers are approximately equal
 */
export function approxEqual(a: number, b: number, epsilon: number = Number.EPSILON): boolean {
  return Math.abs(a - b) < epsilon
}

/**
 * Round to specified decimal places
 * @param value - Value to round
 * @param decimals - Number of decimal places
 * @returns Rounded value
 */
export function roundTo(value: number, decimals: number = 0): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}
