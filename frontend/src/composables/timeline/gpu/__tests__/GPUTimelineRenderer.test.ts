/**
 * GPUTimelineRenderer Unit Tests
 * 
 * Basic tests for GPU renderer initialization and resource management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GPUTimelineRenderer } from '../GPUTimelineRenderer'

describe('GPUTimelineRenderer', () => {
  let mockDevice: any
  let renderer: GPUTimelineRenderer | null = null

  beforeEach(() => {
    // Create mock GPU device
    mockDevice = {
      createBuffer: () => ({
        getMappedRange: () => new ArrayBuffer(1024),
        unmap: () => {},
        destroy: () => {}
      }),
      createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}),
      createShaderModule: () => ({}),
      createRenderPipeline: () => ({}),
      createSampler: () => ({}),
      createTexture: () => ({
        createView: () => ({}),
        destroy: () => {}
      }),
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        beginRenderPass: () => ({
          end: () => {},
          setPipeline: () => {},
          setBindGroup: () => {},
          setVertexBuffer: () => {},
          setIndexBuffer: () => {},
          drawIndexed: () => {}
        }),
        finish: () => ({})
      }),
      queue: {
        writeBuffer: () => {},
        writeTexture: () => {},
        copyExternalImageToTexture: () => {},
        submit: () => {}
      }
    }
  })

  afterEach(() => {
    if (renderer) {
      renderer.cleanup()
      renderer = null
    }
  })

  it('should initialize without errors', () => {
    expect(() => {
      renderer = new GPUTimelineRenderer({
        device: mockDevice,
        presentationFormat: 'rgba8unorm',
        width: 1920,
        height: 1080
      })
    }).not.toThrow()
  })

  it('should create required resources', () => {
    renderer = new GPUTimelineRenderer({
      device: mockDevice,
      presentationFormat: 'rgba8unorm',
      width: 1920,
      height: 1080
    })

    expect(renderer).toBeDefined()
    expect(renderer.getCacheStats).toBeDefined()
  })

  it('should handle cleanup properly', () => {
    renderer = new GPUTimelineRenderer({
      device: mockDevice,
      presentationFormat: 'rgba8unorm',
      width: 1920,
      height: 1080
    })

    expect(() => {
      renderer!.cleanup()
    }).not.toThrow()
  })

  it('should provide cache statistics', () => {
    renderer = new GPUTimelineRenderer({
      device: mockDevice,
      presentationFormat: 'rgba8unorm',
      width: 1920,
      height: 1080
    })

    const stats = renderer.getCacheStats()
    expect(stats).toBeDefined()
    expect(stats.size).toBe(0)
    expect(stats.activeTextures).toBe(0)
  })

  it('should handle resize', () => {
    renderer = new GPUTimelineRenderer({
      device: mockDevice,
      presentationFormat: 'rgba8unorm',
      width: 1920,
      height: 1080
    })

    expect(() => {
      renderer!.resizeRenderTargets(1280, 720)
    }).not.toThrow()
  })
})
