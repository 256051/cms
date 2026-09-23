"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Component, Editor } from "grapesjs";
import { blockLabels, newBlock, newLayout } from "@/lib/page-layout";
import { themeModeStyle } from "@/lib/theme";
import type { PageBlock, PageLayout, ThemeView } from "@/lib/types";
import PageLayoutView from "../PageLayoutView";
import { useLoad } from "./shared";
import "grapesjs/dist/css/grapes.min.css";

export type CanvasHandle = { startDrag: (type: string) => void; endDrag: () => void };

/** GrapesJS owns canvas gestures; the existing validated layout remains the saved document. */
const GrapesCanvas = forwardRef<CanvasHandle, {
  layout: PageLayout; selected: string; disabled: boolean;
  onChange: (layout: PageLayout) => void; onSelect: (id: string) => void;
  onError: (message: string) => void; onTravel: (redo: boolean) => void;
}>(function GrapesCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null), editor = useRef<Editor | null>(null);
  const latest = useRef(props); latest.current = props;
  const syncing = useRef(false);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [device, setDevice] = useState("电脑");
  const { data: theme } = useLoad<ThemeView>("public/theme");
  useImperativeHandle(ref, () => ({
    startDrag(type) {
      const instance = editor.current;
      if (!instance || latest.current.disabled) return;
      instance.Canvas.startDrag({ content: instance.Blocks.get(type).getContent() });
    },
    endDrag() { editor.current?.Canvas.endDrag(); },
  }), []);

  useEffect(() => {
    let disposed = false, queued = false;
    function emit() {
      if (syncing.current || queued || disposed) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const instance = editor.current;
        if (!instance || disposed || syncing.current || latest.current.disabled) return;
        const blocks = instance.getComponents().models.map((component: Component) => component.get("cmsBlock") as PageBlock);
        if (JSON.stringify(blocks) !== JSON.stringify(latest.current.layout.blocks)) {
          latest.current.onChange({ ...latest.current.layout, blocks });
          const selected = instance.getSelected()?.get("cmsBlock") as PageBlock | undefined;
          if (selected) latest.current.onSelect(selected.id);
        }
      });
    }
    import("grapesjs").then(({ default: grapesjs }) => {
      if (disposed || !host.current) return;
      const instance = grapesjs.init({
        container: host.current, height: "650px", width: "auto",
        storageManager: false, telemetry: false, undoManager: false,
        panels: { defaults: [] }, keymaps: { defaults: {} },
        fromElement: false, noticeOnUnload: false, autorender: false,
        // Do not import arbitrary HTML/CSS through canvas paste or external drops.
        canvas: { scripts: [], styles: [], allowExternalDrop: false },
        deviceManager: { devices: [
          { id: "电脑", name: "电脑", width: "" },
          { id: "平板", name: "平板", width: "768px" },
          { id: "手机", name: "手机", width: "375px" },
        ] },
        plugins: [instance => {
          instance.Components.addType("cms-section", {
            model: {
              defaults: { tagName: "div", droppable: false, editable: false, stylable: false,
                copyable: false, draggable: true, traits: [] },
              init() {
                const block = this.get("cmsBlock") as PageBlock | undefined;
                this.set("cmsBlock", block || newBlock(this.get("blockType")));
                this.set("name", blockLabels[this.get("cmsBlock").type]);
              },
            },
            view: {
              init() { this.listenTo(this.model, "change:cmsBlock", this.render); },
              onRender() {
                const block = this.model.get("cmsBlock") as PageBlock;
                const doc = this.el.ownerDocument;
                this.el.setAttribute("data-cms-id", block.id);
                this.el.setAttribute("aria-label", block.title || blockLabels[block.type]);
                this.el.setAttribute("tabindex", "0");
                this.el.classList.toggle("cms-hidden-block", block.hidden);
                const displayed = block.type === "shared"
                  ? { ...block, type: "text", text: "公共区块 · 完整效果可在整页预览中查看" }
                  : block;
                this.el.innerHTML = renderToStaticMarkup(<PageLayoutView layout={newLayout([{ ...displayed, hidden: false }])} preview />);
                // Use the public renderer without nesting its page-width container per section.
                const container = this.el.firstElementChild!;
                container.replaceWith(...Array.from(container.childNodes));
                if (block.hidden) {
                  const badge = doc.createElement("small"); badge.textContent = "已隐藏 · 发布时不显示";
                  this.el.prepend(badge);
                }
                this.el.onclick = event => {
                  if ((event.target as Element).closest("a")) event.preventDefault();
                };
                this.el.onkeydown = event => {
                  if (event.key === "Enter" && event.target === this.el) {
                    instance.select(this.model); latest.current.onSelect(block.id);
                  }
                };
                // Plain titles and descriptions can be edited directly, without accepting pasted markup.
                if (block.type === "shared") return;
                const fields = [[".page-block-copy > h2", "title", 200],
                  [".page-block-copy > .page-block-text", "text", 10000]] as const;
                for (const [selector, key, limit] of fields) {
                  const element = this.el.querySelector<HTMLElement>(selector);
                  if (!element) continue;
                  element.ondblclick = event => {
                    if (latest.current.disabled) return;
                    event.stopPropagation();
                    element.contentEditable = "plaintext-only";
                    element.setAttribute("role", "textbox");
                    element.setAttribute("aria-label", key === "title" ? "画布标题" : "画布说明");
                    element.focus();
                  };
                  element.oninput = () => {
                    const raw = element.innerText, text = raw.slice(0, limit);
                    if (raw.length > limit) {
                      element.innerText = text;
                      latest.current.onError(`${key === "title" ? "标题" : "说明"}最多 ${limit} 个字符。`);
                    }
                    // Keep the focused DOM alive; React receives each edit before autosave can run.
                    this.model.set("cmsBlock", { ...this.model.get("cmsBlock"), [key]: text }, { silent: true });
                    emit();
                  };
                  element.onblur = () => {
                    element.contentEditable = "false";
                    element.removeAttribute("role"); element.removeAttribute("aria-label");
                  };
                }
              },
            },
          });
          Object.keys(blockLabels).filter(type => type !== "shared").forEach(type =>
            instance.Blocks.add(type, { label: blockLabels[type], content: { type: "cms-section", blockType: type } }));
        }],
      });
      editor.current = instance;
      const wrapper = instance.getWrapper()!;
      wrapper.set({ selectable: false, hoverable: false, stylable: false,
        droppable: (source: Component) => !latest.current.disabled &&
          source.get("type") === "cms-section" && (source.parent() === wrapper ||
            (wrapper.components().length < 40 && (source.get("cmsBlock")?.type !== "contact" ||
              !latest.current.layout.blocks.some(block => block.type === "contact")))) });
      instance.on("component:add", (component: Component) => {
        if (syncing.current) return;
        const block = component.get("cmsBlock") as PageBlock | undefined;
        if (!block || instance.getComponents().length > 40 ||
          block.type === "contact" && instance.getComponents().filter((c: Component) => c.get("cmsBlock")?.type === "contact").length > 1) {
          syncing.current = true; component.remove(); syncing.current = false;
          latest.current.onError("每页最多 40 个模块、一个咨询表单。请从组件栏添加内容。"); return;
        }
        instance.select(component);
        emit();
      });
      instance.on("component:remove component:drag:end", emit);
      instance.on("component:selected", (component: Component) => {
        const block = component.get("cmsBlock") as PageBlock | undefined;
        if (block && latest.current.layout.blocks.some(value => value.id === block.id)) latest.current.onSelect(block.id);
      });
      instance.on("load", () => {
        const doc = instance.Canvas.getDocument();
        if (!doc) return;
        doc.documentElement.lang = "zh-CN";
        document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => doc.head.appendChild(node.cloneNode(true)));
        const style = doc.createElement("style");
        style.textContent = 'body{margin:0!important;min-height:100vh}.cms-hidden-block{opacity:.55}.page-mobile-hidden{display:block!important}[data-gjs-type="wrapper"]{min-height:600px!important}[data-gjs-type="wrapper"]:empty:before{content:"从左侧拖入组件，开始设计页面";display:block;padding:90px 24px;text-align:center;color:#64748b}[contenteditable="plaintext-only"]{outline:2px solid #2563eb;cursor:text}';
        doc.head.appendChild(style);
        instance.Canvas.getFrameEl().title = "拖拽设计画布";
        doc.addEventListener("keydown", event => {
          const target = event.target as HTMLElement;
          if (!(event.ctrlKey || event.metaKey) || target.isContentEditable || target.closest("input,textarea")) return;
          if (["z", "y"].includes(event.key.toLowerCase())) {
            event.preventDefault(); latest.current.onTravel(event.key.toLowerCase() === "y" || event.shiftKey);
          }
        });
        setReady(true);
      });
      instance.render();
    }).catch(() => {
      if (!disposed) { setFailed(true); latest.current.onError("设计器加载失败，请刷新页面重试。当前内容仍已保留。"); }
    });
    return () => { disposed = true; editor.current?.destroy(); editor.current = null; };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (!instance || !ready) return;
    syncing.current = true;
    const wrapper = instance.getWrapper()!;
    const wanted = new Set(props.layout.blocks.map(block => block.id));
    [...instance.getComponents().models].forEach(model => {
      if (!wanted.has(model.get("cmsBlock")?.id)) model.remove();
    });
    props.layout.blocks.forEach((block, at) => {
      let model = instance.getComponents().find((model: Component) => model.get("cmsBlock")?.id === block.id);
      if (!model) model = wrapper.append({ type: "cms-section", cmsBlock: block }, { at })[0];
      else {
        if (model.index() !== at) model.move(wrapper, { at });
        if (JSON.stringify(model.get("cmsBlock")) !== JSON.stringify(block)) model.set("cmsBlock", block);
      }
      model.set({ draggable: !props.disabled, removable: !props.disabled });
    });
    syncing.current = false;
  }, [props.layout, props.disabled, ready]);

  useEffect(() => {
    const instance = editor.current;
    if (!instance || !ready) return;
    const model = instance.getComponents().find((model: Component) => model.get("cmsBlock")?.id === props.selected);
    if (model && instance.getSelected() !== model) instance.select(model);
  }, [props.selected, props.layout, ready]);

  useEffect(() => {
    const instance = editor.current;
    if (!ready || !instance) return;
    const body = instance.Canvas.getBody();
    body.className = `public-site has-page-layout theme-${theme?.themeId || "classic"}`;
    body.style.cssText = "";
    if (theme) Object.entries(themeModeStyle(theme)).forEach(([key, value]) => body.style.setProperty(key, String(value)));
    instance.getWrapper()!.getEl()!.className = `page-layout page-width-${props.layout.width}`;
    body.inert = props.disabled;
  }, [theme, ready, props.layout.width, props.disabled]);

  return <section className="grapes-stage" aria-label="页面画布">
    <div className="grapes-device-bar" role="group" aria-label="画布设备">
      {["电脑", "平板", "手机"].map(name => <button type="button" className="secondary" key={name}
        disabled={!ready || props.disabled} aria-pressed={device === name} onClick={() => { setDevice(name); editor.current?.setDevice(name); }}>{name}</button>)}
    </div>
    {!ready && <p role="status">{failed ? "设计器加载失败，请刷新重试。" : "正在加载拖拽设计器…"}</p>}
    <div ref={host} className="grapes-canvas" inert={props.disabled} />
    <small className="muted">拖入组件或点击左侧添加；点击画布选中，双击标题和纯文本直接编辑。</small>
  </section>;
});

export default GrapesCanvas;
