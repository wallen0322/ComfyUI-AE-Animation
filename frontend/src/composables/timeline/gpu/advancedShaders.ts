/**
 * Advanced Timeline Renderer Shaders with Matrix Transformations
 * 
 * These shaders support full 3D transformations including camera rotation.
 * Use these when camera rotation (yaw/pitch/roll) is needed.
 */

// ============================================================================
// Advanced Vertex Shader with Matrix Transformations
// ============================================================================

export const advancedLayerVertexShader = `
struct LayerUniforms {
  opacity: f32,
  // Camera rotation matrix (3x3, stored as 3 vec4s for alignment)
  rotationRow0: vec4<f32>,  // [r00, r01, r02, padding]
  rotationRow1: vec4<f32>,  // [r10, r11, r12, padding]
  rotationRow2: vec4<f32>,  // [r20, r21, r22, padding]
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) opacity: f32,
}

@group(0) @binding(0) var<uniform> uniforms: LayerUniforms;

@vertex
fn vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VertexOutput {
  // Apply camera rotation to vertex position
  // Extract rotation matrix
  let r00 = uniforms.rotationRow0.x;
  let r01 = uniforms.rotationRow0.y;
  let r02 = uniforms.rotationRow0.z;
  let r10 = uniforms.rotationRow1.x;
  let r11 = uniforms.rotationRow1.y;
  let r12 = uniforms.rotationRow1.z;
  let r20 = uniforms.rotationRow2.x;
  let r21 = uniforms.rotationRow2.y;
  let r22 = uniforms.rotationRow2.z;
  
  // Apply rotation (pos is already in NDC space)
  let rotatedX = r00 * pos.x + r01 * pos.y;
  let rotatedY = r10 * pos.x + r11 * pos.y;
  
  var output: VertexOutput;
  output.position = vec4<f32>(rotatedX, rotatedY, 0.0, 1.0);
  output.uv = uv;
  output.opacity = uniforms.opacity;
  return output;
}
`

// ============================================================================
// Advanced Fragment Shader (same as basic)
// ============================================================================

export const advancedLayerFragmentShader = `
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
