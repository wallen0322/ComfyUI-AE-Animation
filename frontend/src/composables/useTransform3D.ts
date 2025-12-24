/**
 * 3D Transform utilities for AE-style layer transforms
 * Provides CSS transform string generation and matrix operations
 */

export interface Layer3DProps {
  x: number
  y: number
  z: number
  rotationX: number
  rotationY: number
  rotationZ: number
  scaleX: number
  scaleY: number
  scaleZ: number
  anchorX: number
  anchorY: number
  opacity: number
}

export interface CameraProps {
  cam_pos_x: number
  cam_pos_y: number
  cam_pos_z: number
  cam_yaw: number
  cam_pitch: number
  cam_roll: number
  cam_fov: number
}

/**
 * Build CSS transform string for 3D layer
 * Transform order: translate3d → rotateX → rotateY → rotateZ → scale3d
 * This matches the backend matrix multiplication order
 */
export function buildCSSTransform(props: Layer3DProps, imgWidth: number, imgHeight: number): string {
  const {
    x, y, z,
    rotationX, rotationY, rotationZ,
    scaleX, scaleY, scaleZ,
    anchorX, anchorY
  } = props

  // Anchor offset (in pixels from layer center)
  const anchorOffsetX = anchorX * imgWidth
  const anchorOffsetY = anchorY * imgHeight

  const transforms: string[] = []

  // 1. Translate to position (including anchor offset compensation)
  transforms.push(`translate3d(${x - anchorOffsetX}px, ${y - anchorOffsetY}px, ${z}px)`)

  // 2. Apply rotations (X → Y → Z order, same as AE)
  if (rotationX !== 0) transforms.push(`rotateX(${rotationX}deg)`)
  if (rotationY !== 0) transforms.push(`rotateY(${rotationY}deg)`)
  if (rotationZ !== 0) transforms.push(`rotateZ(${rotationZ}deg)`)

  // 3. Apply scale
  if (scaleX !== 1 || scaleY !== 1 || scaleZ !== 1) {
    transforms.push(`scale3d(${scaleX}, ${scaleY}, ${scaleZ})`)
  }

  return transforms.join(' ')
}

/**
 * Build CSS transform-origin string based on anchor point
 */
export function buildTransformOrigin(anchorX: number, anchorY: number): string {
  // Convert from -0.5 to 0.5 range to percentage
  const originX = (0.5 + anchorX) * 100
  const originY = (0.5 + anchorY) * 100
  return `${originX}% ${originY}%`
}

/**
 * Build CSS perspective value from camera FOV
 */
export function buildPerspective(fov: number, viewportHeight: number): number {
  // Convert FOV to perspective distance
  // perspective = viewportHeight / (2 * tan(fov/2))
  const fovRad = (Math.max(1, Math.min(179, fov)) * Math.PI) / 180
  return viewportHeight / (2 * Math.tan(fovRad / 2))
}

/**
 * Build camera transform for the scene container
 */
export function buildCameraTransform(camera: CameraProps): string {
  const { cam_pos_x, cam_pos_y, cam_pos_z, cam_yaw, cam_pitch, cam_roll } = camera

  const transforms: string[] = []

  // Camera transform is inverse of what we want to see
  // So we negate the values
  if (cam_roll !== 0) transforms.push(`rotateZ(${-cam_roll}deg)`)
  if (cam_pitch !== 0) transforms.push(`rotateX(${-cam_pitch}deg)`)
  if (cam_yaw !== 0) transforms.push(`rotateY(${-cam_yaw}deg)`)
  
  transforms.push(`translate3d(${-cam_pos_x}px, ${-cam_pos_y}px, ${-cam_pos_z}px)`)

  return transforms.join(' ')
}

/**
 * Calculate Z-depth for layer sorting
 * Returns the Z position after applying camera view transform
 */
export function getLayerZDepth(
  layerX: number, layerY: number, layerZ: number,
  camera: CameraProps
): number {
  // Simplified Z-depth calculation for sorting
  // In a full implementation, this would use the view matrix
  const { cam_pos_x, cam_pos_y, cam_pos_z, cam_yaw, cam_pitch } = camera
  
  // Translate relative to camera
  const dx = layerX - cam_pos_x
  const dy = layerY - cam_pos_y
  const dz = layerZ - cam_pos_z

  // Apply camera rotation (simplified)
  const yawRad = (cam_yaw * Math.PI) / 180
  const pitchRad = (cam_pitch * Math.PI) / 180

  const cosY = Math.cos(yawRad)
  const sinY = Math.sin(yawRad)
  const cosP = Math.cos(pitchRad)
  const sinP = Math.sin(pitchRad)

  // Rotate around Y then X
  const z1 = dx * sinY + dz * cosY
  const z2 = dy * sinP + z1 * cosP

  return z2
}

/**
 * Sort layers by Z-depth (far to near for painter's algorithm)
 */
export function sortLayersByDepth<T extends { x: number; y: number; z: number }>(
  layers: T[],
  camera: CameraProps
): T[] {
  return [...layers].sort((a, b) => {
    const zA = getLayerZDepth(a.x, a.y, a.z, camera)
    const zB = getLayerZDepth(b.x, b.y, b.z, camera)
    return zB - zA // Far to near (higher Z = farther)
  })
}

/**
 * Build 4x4 model matrix (same as backend)
 */
export function buildModelMatrix(props: Layer3DProps): number[] {
  const { x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, anchorX, anchorY } = props
  
  const deg2rad = Math.PI / 180
  const rx = rotationX * deg2rad
  const ry = rotationY * deg2rad
  const rz = rotationZ * deg2rad

  const cx = Math.cos(rx), sx = Math.sin(rx)
  const cy = Math.cos(ry), sy = Math.sin(ry)
  const cz = Math.cos(rz), sz = Math.sin(rz)

  // Rotation matrix: Rz * Ry * Rx (Z → Y → X order, same as AE)
  // Combined rotation matrix (apply Rz first, then Ry, then Rx)
  // Rz * Ry * Rx =
  // | cy*cz  -cy*sz  sy |
  // | sx*sy*cz + cx*sz  -sx*sy*sz + cx*cz  -sx*cy |
  // | -cx*sy*cz + sx*sz  cx*sy*sz + sx*cz  cx*cy |
  const r00 = cy * cz
  const r01 = -cy * sz
  const r02 = sy
  const r10 = sx * sy * cz + cx * sz
  const r11 = -sx * sy * sz + cx * cz
  const r12 = -sx * cy
  const r20 = -cx * sy * cz + sx * sz
  const r21 = cx * sy * sz + sx * cz
  const r22 = cx * cy

  // Scale
  const m00 = r00 * scaleX
  const m01 = r01 * scaleY
  const m02 = r02 * scaleZ
  const m10 = r10 * scaleX
  const m11 = r11 * scaleY
  const m12 = r12 * scaleZ
  const m20 = r20 * scaleX
  const m21 = r21 * scaleY
  const m22 = r22 * scaleZ

  // Translation with anchor offset
  const tx = x - anchorX * m00 - anchorY * m01
  const ty = y - anchorX * m10 - anchorY * m11
  const tz = z - anchorX * m20 - anchorY * m21

  // Column-major order for WebGL/CSS
  return [
    m00, m10, m20, 0,
    m01, m11, m21, 0,
    m02, m12, m22, 0,
    tx, ty, tz, 1
  ]
}

export default {
  buildCSSTransform,
  buildTransformOrigin,
  buildPerspective,
  buildCameraTransform,
  getLayerZDepth,
  sortLayersByDepth,
  buildModelMatrix
}
