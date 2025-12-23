import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './timeline.css'
import TimelineApp from './TimelineApp.vue'

export interface TimelineAppOptions {
  node: any
}

export function createTimelineApp(
  container: HTMLElement,
  options: TimelineAppOptions
) {
  const app = createApp(TimelineApp, {
    node: options.node
  })
  
  const pinia = createPinia()
  app.use(pinia)

  const vm = app.mount(container) as any

  // Expose useful methods for the ComfyUI dialog wrapper (js/ae_timeline_ext.js)
  ;(app as any).save = async () => {
    const exposed = vm?.$?.exposed
    if (exposed?.save) {
      await exposed.save()
      return
    }
    if (vm?.save) {
      await vm.save()
    }
  }

  return app as any
}

// Export to global for timeline.js to access
declare global {
  interface Window {
    createTimelineApp: typeof createTimelineApp
  }
}

window.createTimelineApp = createTimelineApp
