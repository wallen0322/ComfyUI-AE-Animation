/**
 * Timeline Renderer Shaders
 * 
 * WGSL shader code for rendering timeline layers with GPU acceleration.
 */

// ============================================================================
// Vertex Shader for Standard Layer Rendering
// ============================================================================

export const layerVertexShader = `
struct LayerUniforms {
  opacity: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) opacity: f32,
}

@group(0) @binding(0) var<uniform> uniforms: LayerUniforms;

@vertex
fn vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(pos, 0.0, 1.0);
  output.uv = uv;
  output.opacity = uniforms.opacity;
  return output;
}
`

// ============================================================================
// Fragment Shader for Textured Layers
// ============================================================================

export const layerFragmentShader = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) opacity: f32,
}

@group(1) @binding(0) var layerTexture: texture_2d<f32>;
@group(1) @binding(1) var maskTexture: texture_2d<f32>;
@group(1) @binding(2) var layerSampler: sampler;

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
  var color = textureSample(layerTexture, layerSampler, input.uv);
  let mask = textureSample(maskTexture, layerSampler, input.uv);
  
  // Apply opacity
  color.a *= (input.opacity * mask.a);
  
  // Return premultiplied alpha
  return vec4<f32>(color.rgb * color.a, color.a);
}
`

// ============================================================================
// Panorama Fragment Shader for Equirectangular Projection
// ============================================================================

export const panoramaFragmentShader = `
struct PanoramaUniforms {
  yaw: f32,
  pitch: f32,
  roll: f32,
  fov: f32,
  aspectRatio: f32,
  padding: f32,
  screenSize: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) opacity: f32,
}

@group(0) @binding(0) var<uniform> uniforms: PanoramaUniforms;
@group(1) @binding(0) var panoTexture: texture_2d<f32>;
@group(1) @binding(2) var panoSampler: sampler;

fn screenToRay(screenPos: vec2<f32>) -> vec3<f32> {
  // Convert screen position to normalized coordinates [-1, 1]
  // 与Canvas 2D一致: nx = (xPix + 0.5) / prevW * 2 - 1
  let nx = (screenPos.x / uniforms.screenSize.x) * 2.0 - 1.0;
  // Canvas 2D: ny = (yPix + 0.5) / prevH * 2 - 1
  let ny = (screenPos.y / uniforms.screenSize.y) * 2.0 - 1.0;
  
  // Calculate ray direction based on FOV
  // 与Canvas 2D一致: vx = nx * tanHalfFov * aspect, vy = -ny * tanHalfFov
  // Clamp FOV to valid range [10, 170] degrees (与Canvas 2D一致)
  let fovClamped = clamp(uniforms.fov, 10.0, 170.0);
  let tanHalfFov = tan(fovClamped * 0.5 * 0.01745329); // deg to rad
  let vx = nx * tanHalfFov * uniforms.aspectRatio;
  let vy = -ny * tanHalfFov;
  let vz = 1.0;
  
  // Normalize ray
  let len = sqrt(vx * vx + vy * vy + vz * vz);
  return vec3<f32>(vx / len, vy / len, vz / len);
}

fn applyCameraRotation(ray: vec3<f32>) -> vec3<f32> {
  // Convert degrees to radians
  let yawRad = uniforms.yaw * 0.01745329;
  let pitchRad = uniforms.pitch * 0.01745329;
  let rollRad = uniforms.roll * 0.01745329;
  
  // Build rotation components - 与Canvas 2D完全一致的顺序
  let cy = cos(yawRad);
  let sy = sin(yawRad);
  let cp = cos(pitchRad);
  let sp = sin(pitchRad);
  let cr = cos(rollRad);
  let sr = sin(rollRad);
  
  var vx = ray.x;
  var vy = ray.y;
  var vz = ray.z;
  
  // Apply Yaw (Y轴旋转) - 与Canvas 2D一致
  var tx = cy * vx + sy * vz;
  var tz = -sy * vx + cy * vz;
  vx = tx;
  vz = tz;
  
  // Apply Pitch (X轴旋转) - 与Canvas 2D一致
  var ty = cp * vy - sp * vz;
  tz = sp * vy + cp * vz;
  vy = ty;
  vz = tz;
  
  // Apply Roll (Z轴旋转) - 与Canvas 2D一致
  tx = cr * vx - sr * vy;
  ty = sr * vx + cr * vy;
  vx = tx;
  vy = ty;
  
  return vec3<f32>(vx, vy, vz);
}

fn rayToEquirectangular(ray: vec3<f32>) -> vec2<f32> {
  // Convert ray to spherical coordinates - 与Canvas 2D完全一致
  let lon = atan2(ray.x, ray.z);
  let lat = asin(clamp(ray.y, -1.0, 1.0));
  
  // Map to UV coordinates [0, 1] - 与Canvas 2D的映射一致
  // Canvas 2D: u = ((lon / (Math.PI * 2)) + 0.5) * imgW
  //            v = ((0.5 - (lat / Math.PI))) * imgH
  let u = (lon / (3.14159265 * 2.0)) + 0.5;
  let v = 0.5 - (lat / 3.14159265);  // 与Canvas 2D一致
  
  return vec2<f32>(u, v);
}

@vertex
fn vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(pos, 0.0, 1.0);
  output.uv = uv;
  output.opacity = 1.0;
  return output;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
  // Convert screen position to ray direction
  var ray = screenToRay(input.position.xy);
  
  // Apply camera rotation
  ray = applyCameraRotation(ray);
  
  // Convert ray to equirectangular UV
  let uv = rayToEquirectangular(ray);
  
  // Sample panorama texture
  var color = textureSample(panoTexture, panoSampler, uv);
  
  // Return with full opacity (panorama should be opaque)
  return vec4<f32>(color.rgb, 1.0);
}
`

// ============================================================================
// Mask Compositing Shader
// ============================================================================

export const maskCompositeShader = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) opacity: f32,
}

@group(0) @binding(0) var layerTexture: texture_2d<f32>;
@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var textureSampler: sampler;

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let color = textureSample(layerTexture, textureSampler, input.uv);
  let mask = textureSample(maskTexture, textureSampler, input.uv);
  
  // Destination-in compositing: multiply alpha by mask alpha
  var result = color;
  result.a *= mask.a;
  
  return result;
}
`

// ============================================================================
// Simple Blit Shader for Copying Textures
// ============================================================================

export const blitShader = `
@vertex fn vs(@builtin(vertex_index) vIdx: u32) -> @builtin(position) vec4<f32> {
  // Full-screen triangle
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(pos[vIdx], 0.0, 1.0);
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let coords = vec2<i32>(pos.xy);
  return textureLoad(sourceTexture, coords, 0);
}
`

// ============================================================================
// Overlay Shader for Path/Mask/Extract Visualization
// ============================================================================

export const overlayShader = `
@group(0) @binding(0) var<uniform> overlayColor: vec4<f32>;

@vertex fn vs(@location(0) pos: vec2<f32>) -> @builtin(position) vec4<f32> {
  return vec4<f32>(pos, 0.0, 1.0);
}

@fragment fn fs() -> @location(0) vec4<f32> {
  return overlayColor;
}
`
