import { app } from "../../scripts/app.js";

// AE Timeline dialog singleton
let aeTimelineDialog = null;

// 静态目录 WEB_DIRECTORY = "./js"，对外路径无需再带 /js 前缀
const ASSET_BASE = "/extensions/ComfyUI-AE-Animation/vue-dist";

async function ensureVueTimelineLoaded() {
  // Always ensure CSS is present (even if createTimelineApp already exists)
  if (!document.querySelector('link[data-ae-timeline-css="1"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${ASSET_BASE}/assets/timeline.css`;
    link.dataset.aeTimelineCss = "1";
    document.head.appendChild(link);
  }

  if (!document.querySelector('link[data-ae-mask-css="1"]')) {
    const maskLink = document.createElement("link");
    maskLink.rel = "stylesheet";
    maskLink.href = `${ASSET_BASE}/assets/mask-editor.css`;
    maskLink.dataset.aeMaskCss = "1";
    document.head.appendChild(maskLink);
  }

  // Load entry module only if not already present
  if (!window.createTimelineApp) {
    const script = document.createElement("script");
    script.type = "module";
    script.src = `${ASSET_BASE}/timeline.js`;

    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    // Give the module a brief moment to initialize
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function openAETimelineForNode(node) {
  await ensureVueTimelineLoaded();

  // Close existing dialog if present
  if (aeTimelineDialog) {
    try {
      aeTimelineDialog.close();
    } catch {
      // ignore
    }
    aeTimelineDialog.remove();
    aeTimelineDialog = null;
  }

  const dialog = document.createElement("dialog");
  dialog.className = "ae-timeline-dialog";
  Object.assign(dialog.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(98vw, 2400px)",
    height: "min(96vh, 1400px)",
    maxWidth: "98vw",
    maxHeight: "96vh",
    padding: "0",
    margin: "0",
    border: "1px solid #444",
    borderRadius: "8px",
    background: "#1a1a1a",
    zIndex: "10000",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  });

  const container = document.createElement("div");
  // Vue 组件会创建 .ae-timeline-root 作为根元素，这里不需要额外样式
  container.style.cssText = "width: 100%; height: 100%;";

  dialog.appendChild(container);
  document.body.appendChild(dialog);

  if (!window.createTimelineApp) {
    container.innerHTML = '<div style="padding:20px;color:#f44">Failed to load AE Timeline Vue app. Please check console.</div>';
    dialog.showModal();
    return;
  }

  const vueApp = window.createTimelineApp(container, { node });

  dialog.addEventListener("close", () => {
    try {
      vueApp.unmount && vueApp.unmount();
    } catch {
      // ignore
    }
    try {
      // 自动保存一次节点，避免丢失
      if (node && typeof node.save === "function") node.save();
      const graph = getGraph();
      if (graph?.setDirtyCanvas) graph.setDirtyCanvas(true, true);
    } catch (e) {
      console.warn("[AE Timeline] autosave on close failed", e);
    }
    dialog.remove();
    if (aeTimelineDialog === dialog) {
      aeTimelineDialog = null;
    }
  });

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dialog.close();
      return;
    }

    // Prevent ComfyUI canvas from receiving delete/backspace while the dialog is open
    if (e.key === "Delete" || e.key === "Backspace") {
      e.stopPropagation();

      const tag = (e.target && e.target.tagName) || "";
      const isTypingTarget =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target && e.target.isContentEditable);

      // Avoid browser/back navigation or other default delete behaviors when not editing text
      if (!isTypingTarget) {
        e.preventDefault();
      }
    }
  });

  aeTimelineDialog = dialog;
  dialog.showModal();
}

function getGraph() {
  return (
    app?.graph ||
    app?.canvas?.graph ||
    (window.LGraphCanvas && window.LGraphCanvas.active_canvas && window.LGraphCanvas.active_canvas.graph) ||
    null
  );
}

function getSelectedAEAnimationNode() {
  const canvas = window.LGraphCanvas && window.LGraphCanvas.active_canvas;
  if (!canvas) return null;
  const selected = canvas.selected_nodes || {};
  const nodes = Object.values(selected);
  return nodes.find((n) => n && n.constructor && n.constructor.comfyClass === "AEAnimation") || null;
}

function findExistingAEAnimation(graph) {
  if (!graph) return null;
  if (typeof graph.findNodesByType === "function") {
    const list = graph.findNodesByType("AEAnimation");
    if (list && list.length) return list[0];
  }
  if (Array.isArray(graph._nodes)) {
    const found = graph._nodes.find((n) => n?.constructor?.comfyClass === "AEAnimation");
    if (found) return found;
  }
  return null;
}

function createAEAnimationNode() {
  try {
    const LiteGraph = window.LiteGraph;
    const graph = getGraph();
    if (!LiteGraph || !graph) return null;
    const node = LiteGraph.createNode("AEAnimation");
    if (!node) return null;
    const canvas = window.LGraphCanvas && window.LGraphCanvas.active_canvas;
    if (canvas?.convertEventToCanvas) {
      node.pos = canvas.convertEventToCanvas([200, 200]);
    } else {
      node.pos = [200, 200];
    }
    graph.add(node);
    canvas?.setDirty?.(true, true);
    canvas?.selectNode?.(node, false);
    return node;
  } catch (e) {
    console.error("[AE Timeline] Failed to create AEAnimation node", e);
    return null;
  }
}

function ensureAEAnimationNode() {
  const graph = getGraph();
  let node = getSelectedAEAnimationNode();
  if (!node) node = findExistingAEAnimation(graph);
  if (!node) node = createAEAnimationNode();
  return node;
}

app.registerExtension({
  name: "ComfyUI.AEAnimation.TimelineExt",
  // Hide advanced widgets on the node UI for a cleaner look
  nodeCreated(node) {
    if (!node || node.constructor?.comfyClass !== "AEAnimation") return;
    const hideSet = new Set(["mask_expansion", "mask_feather", "layers_keyframes", "start_frame", "end_frame"]);
    if (!node.widgets) return;
    node.widgets.forEach((w) => {
      if (hideSet.has(w.name)) {
        w.computeSize = () => [0, 0];
        w.draw = () => {};
        w.hidden = true;
      }
    });
    // Reduce height after hiding
    if (typeof node.computeSize === "function") {
      const sz = node.computeSize(node.size);
      if (Array.isArray(sz) && sz.length === 2) {
        node.size[1] = Math.min(node.size[1], sz[1]);
      }
    }
  },
  setup() {
    const comfyAPI = window.comfyAPI;
    const ComfyButton = comfyAPI && comfyAPI.button && comfyAPI.button.ComfyButton;
    if (!ComfyButton || !app.menu || !app.menu.settingsGroup) return;

    app.menu.settingsGroup.append(
      new ComfyButton({
        icon: "timeline",
        tooltip: "AE Animation Timeline",
        content: "AE Timeline",
        action: async () => {
          const node = ensureAEAnimationNode();
          if (!node) {
            alert("无法创建或获取 AE Animation 节点");
            return;
          }
          await openAETimelineForNode(node);
        },
      }),
    );
  },
  getNodeMenuItems(node) {
    const nodeClass = node && node.constructor && node.constructor.comfyClass;
    if (nodeClass !== "AEAnimation") return [];

    return [
      null,
      {
        content: "Open AE Timeline",
        callback: () => {
          openAETimelineForNode(node);
        },
      },
    ];
  },
});
