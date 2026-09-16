"use client";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2, Undo2, Redo2 } from "lucide-react";
import { api } from "@/lib/client";
import { blockLabels, newBlock, newItem, starterLabels, starterLayout } from "@/lib/page-layout";
import type { Asset, Content, Page, PageBlock, PageBlockItem, PageLayout, Taxonomy } from "@/lib/types";
import AssetSelector from "./AssetSelector";
import LayoutPreview from "./LayoutPreview";
import RichEditor from "./RichEditor";
import { Notice, Pager, useLoad } from "./shared";

export default function PageBuilder({ layout, title, disabled, onChange: commitLayout, onBusyChange, allowReferences = true, fields = [] }: {
  layout: PageLayout; title: string; disabled: boolean; onChange: (value: PageLayout) => void; onBusyChange: (busy: boolean) => void; allowReferences?: boolean; fields?: Content["fields"];
}) {
  const [selected, setSelected] = useState(layout.blocks[0]?.id || ""), [error, setError] = useState("");
  const [templatePage, setTemplatePage] = useState(1), [templateSearch, setTemplateSearch] = useState("");
  const [blockPage, setBlockPage] = useState(1), [blockSearch, setBlockSearch] = useState("");
  const library = useLoad<Page<Content>>(`admin/contents?kind=block&status=published&page=${blockPage}&q=${encodeURIComponent(blockSearch)}`);
  const [dragged, setDragged] = useState("");
  const [richWide, setRichWide] = useState(false);
  const history = useRef({ past: [] as PageLayout[], future: [] as PageLayout[] });
  function onChange(next: PageLayout) {
    const serialized = JSON.stringify(next);
    if (serialized === JSON.stringify(layout)) return;
    // Keep a bounded in-session history; persisted revisions cover earlier work.
    history.current = { past: [...history.current.past, layout].slice(-30), future: [] };
    commitLayout(next);
  }
  function travel(redo: boolean) {
    if (disabled) return;
    const state = history.current, source = redo ? state.future : state.past;
    const next = source.pop();
    if (!next) return;
    (redo ? state.past : state.future).push(layout);
    setSelected(next.blocks.some(x => x.id === selected) ? selected : next.blocks[0]?.id || "");
    commitLayout(next);
  }
  const templates = useLoad<Page<Content>>(`admin/contents?kind=template&status=published&page=${templatePage}&q=${encodeURIComponent(templateSearch)}`);
  const terms = useLoad<Taxonomy[]>("admin/taxonomy");
  const current = layout.blocks.find(x => x.id === selected);
  const index = layout.blocks.findIndex(x => x.id === selected);
  function update(patch: Partial<PageBlock>) {
    onChange({ ...layout, blocks: layout.blocks.map(x => x.id === selected ? { ...x, ...patch } : x) });
  }
  function mobileChange(patch: Partial<NonNullable<PageBlock["mobile"]>>) {
    update({ mobile: { align: "", spacing: "", columns: 1, textSize: "", hidden: false, ...current?.mobile, ...patch } });
  }
  function move(id: string, position: number) {
    if (disabled || position < 0 || position >= layout.blocks.length) return;
    const blocks = [...layout.blocks], from = blocks.findIndex(x => x.id === id);
    if (from < 0 || from === position) return;
    blocks.splice(position, 0, blocks.splice(from, 1)[0]); onChange({ ...layout, blocks });
  }
  function replace(next: PageLayout) {
    if (layout.blocks.length && !confirm("使用模板将替换当前页面模块。保存过的版本可从历史恢复，是否继续？")) return;
    const blocks = next.blocks.map(x => ({ ...x, id: crypto.randomUUID().replaceAll("-", "") }));
    onChange({ ...next, blocks }); setSelected(blocks[0]?.id || "");
  }
  function itemChange(i: number, patch: Partial<PageBlockItem>) {
    if (current) update({ items: current.items.map((item, n) => n === i ? { ...item, ...patch } : item) });
  }
  async function insertShared(id: string, copy: boolean) {
    onBusyChange(true); setError("");
    try {
      const value = await api<Content>(`admin/blocks/${id}`);
      if (!value.layout) throw new Error("此公共区块尚未配置布局。");
      const added = copy ? value.layout.blocks.map(block => ({ ...block, id: crypto.randomUUID().replaceAll("-", "") }))
        : [{ ...newBlock("shared"), sharedId: id, title: value.title }];
      const next = { ...layout, blocks: [...layout.blocks, ...added] };
      await api<PageLayout>("admin/layout-preview", "POST", next);
      onChange(next); setSelected(added[0]?.id || selected);
    } catch (e) { setError((e as Error).message); } finally { onBusyChange(false); }
  }
  async function upload(file: File | undefined, accept: (id: string) => void) {
    if (!file) return;
    onBusyChange(true); setError("");
    try { const form = new FormData(); form.append("file", file); accept((await api<Asset>("admin/assets", "POST", form)).id); }
    catch (e) { setError((e as Error).message); } finally { onBusyChange(false); }
  }
  function imageFields(item: PageBlockItem | PageBlock, change: (patch: Partial<PageBlockItem>) => void, label: string) {
    return <div className="builder-image-fields">{item.imageId && <img src={`/media/${item.imageId}`} alt={item.imageAlt || "所选图片"} />}
      <AssetSelector label={`${label}图片`} disabled={disabled} value={item.imageId} onChange={imageId => change({ imageId })} />
      <label>上传{label}图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => void upload(e.target.files?.[0], imageId => change({ imageId }))} /></label>
      <label>图片说明<input value={item.imageAlt} maxLength={300} onChange={e => change({ imageAlt: e.target.value })} /></label></div>;
  }
  function linkFields(item: PageBlockItem | PageBlock, change: (patch: Partial<PageBlockItem>) => void) {
    return <div className="form-grid"><label>按钮文字<input value={item.linkText} maxLength={100} onChange={e => change({ linkText: e.target.value })} /></label>
      <label>按钮链接<input value={item.linkUrl} maxLength={1000} placeholder="/pages/about 或 https://…" onChange={e => change({ linkUrl: e.target.value })} /></label></div>;
  }
  return <div className="page-builder" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey) || (event.target as Element).closest("input, textarea, [contenteditable=true], dialog")) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") { event.preventDefault(); travel(key === "y" || event.shiftKey); }
  }}><Notice error={error || terms.error} />
    <div className="builder-toolbar"><strong>页面设计</strong><div className="row-actions">
      <button type="button" className="secondary" disabled={disabled || !history.current.past.length} onClick={() => travel(false)}><Undo2 size={16} />撤销操作</button>
      <button type="button" className="secondary" disabled={disabled || !history.current.future.length} onClick={() => travel(true)}><Redo2 size={16} />重做操作</button>
    </div></div>
    <details className="builder-templates"><summary>选择起始模板或已发布模板</summary><div className="starter-grid">
      {Object.entries(starterLabels).map(([key, label]) => <button type="button" disabled={disabled} className="secondary" key={key} onClick={() => replace(starterLayout(key as keyof typeof starterLabels))}>{label}</button>)}</div>
      <label>搜索已发布模板<input value={templateSearch} onChange={e => { setTemplateSearch(e.target.value); setTemplatePage(1); }} maxLength={200} placeholder="输入模板名称" /></label>
      <Notice error={templates.error} /><div className="starter-grid">{templates.data?.items.map(template => <button key={template.id} type="button" disabled={disabled} className="secondary" onClick={async () => {
        onBusyChange(true); setError("");
        try { const value = await api<Content>(`admin/templates/${template.id}`); if (value.layout) replace(value.layout); }
        catch (e) { setError((e as Error).message); } finally { onBusyChange(false); }
      }}>{template.title}</button>)}</div>
      {templates.data?.total === 0 && <p className="muted">还没有已发布模板。可将设计另存为模板，发布后出现在这里。</p>}<Pager data={templates.data} setPage={setTemplatePage} />
    </details>
    <details className="builder-templates"><summary>从公共区块库插入</summary>
      <p className="muted">独立复制后可单独修改；同步引用会跟随公共区块的发布版本更新。</p>
      <label>搜索公共区块<input value={blockSearch} maxLength={200} onChange={e => { setBlockSearch(e.target.value); setBlockPage(1); }} /></label>
      <Notice error={library.error} /><div className="starter-grid">{library.data?.items.map(block => <div key={block.id}><strong>{block.title}</strong><div className="row-actions">
        <button type="button" className="secondary" disabled={disabled} onClick={() => void insertShared(block.id, true)}>独立复制</button>
        {allowReferences && <button type="button" className="secondary" disabled={disabled} onClick={() => void insertShared(block.id, false)}>同步引用</button>}
      </div></div>)}</div>{library.data?.total === 0 && <p className="muted">暂无已发布公共区块，可先到公共区块管理中创建并发布。</p>}
      {!allowReferences && <small>公共区块内部使用独立副本，避免循环引用。</small>}<Pager data={library.data} setPage={setBlockPage} />
    </details>
    <fieldset disabled={disabled} className="builder-options"><legend>页面外观</legend><label>内容宽度<select value={layout.width} onChange={e => onChange({ ...layout, width: e.target.value })}>
      <option value="wide">宽版</option><option value="normal">标准</option><option value="narrow">阅读窄版</option></select></label>
      {([["showTitle", "显示页面标题"], ["showHeader", "显示站点页头"], ["showFooter", "显示站点页脚"]] as const).map(([key, label]) => <label className="checkbox-label" key={key}><input type="checkbox" checked={layout[key]} onChange={e => onChange({ ...layout, [key]: e.target.checked })} />{label}</label>)}
    </fieldset>
    <div className="builder-workspace"><aside className="builder-outline"><h3>页面模块 <small>{layout.blocks.length} / 40</small></h3>
      <div className="block-inserter">{Object.entries(blockLabels).filter(([type]) => type !== "shared").map(([type, label]) => <button type="button" key={type} className="secondary" disabled={disabled || layout.blocks.length >= 40 || type === "contact" && layout.blocks.some(x => x.type === type)} onClick={() => {
        const block = newBlock(type); onChange({ ...layout, blocks: [...layout.blocks, block] }); setSelected(block.id);
      }}><Plus size={14} />{label}</button>)}</div>
      <ol className="block-outline-list" aria-label="模块顺序">{layout.blocks.map((block, n) => <li key={block.id} draggable={!disabled} onDragStart={() => setDragged(block.id)} onDragEnd={() => setDragged("")}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); move(dragged, n); setDragged(""); }}>
        <button type="button" className="secondary" aria-pressed={selected === block.id} onClick={() => setSelected(block.id)}><GripVertical size={14} aria-hidden="true" /><span>{block.title || blockLabels[block.type]}{block.hidden && <small>已隐藏</small>}</span></button>
      </li>)}</ol><small className="muted">拖动调整顺序，也可使用模块设置中的上移、下移按钮。</small></aside>
      <section className="builder-properties" aria-label="模块设置">{current ? <fieldset disabled={disabled} className="form-fields" key={current.id}>
        <legend>{blockLabels[current.type]}设置</legend><div className="row-actions">
          <button type="button" className="secondary" disabled={index === 0} onClick={() => move(current.id, index - 1)}><ArrowUp size={15} />上移</button>
          <button type="button" className="secondary" disabled={index === layout.blocks.length - 1} onClick={() => move(current.id, index + 1)}><ArrowDown size={15} />下移</button>
          <button type="button" className="secondary" disabled={layout.blocks.length >= 40 || current.type === "contact"} onClick={() => { const copy = { ...current, id: crypto.randomUUID().replaceAll("-", "") }; const blocks = [...layout.blocks]; blocks.splice(index + 1, 0, copy); onChange({ ...layout, blocks }); setSelected(copy.id); }}><Copy size={15} />复制模块</button>
          <button type="button" className="danger secondary" onClick={() => { if (!confirm("删除此模块？")) return; const blocks = layout.blocks.filter(x => x.id !== current.id); onChange({ ...layout, blocks }); setSelected(blocks[Math.max(0, index - 1)]?.id || ""); }}><Trash2 size={15} />删除模块</button>
        </div><label className="checkbox-label"><input type="checkbox" checked={current.hidden} onChange={e => update({ hidden: e.target.checked })} />隐藏模块（保留编辑内容）</label>
        {current.type === "shared" ? <><p>同步引用：{current.title}。页面显示此区块的已发布内容。</p>
          <a href={`/admin/blocks/${current.sharedId}`} target="_blank" rel="noreferrer">编辑公共区块</a>
          <label className="checkbox-label"><input type="checkbox" checked={current.mobile?.hidden || false} onChange={e => mobileChange({ hidden: e.target.checked })} />仅在手机隐藏</label>
          <button type="button" className="secondary" onClick={async () => {
            onBusyChange(true); setError("");
            try { const value = await api<Content>(`admin/blocks/${current.sharedId}`);
              const added = (value.layout?.blocks || []).map(block => ({ ...block, id: crypto.randomUUID().replaceAll("-", ""), hidden: current.hidden || block.hidden,
                mobile: { align: "", spacing: "", columns: 1, textSize: "", ...block.mobile, hidden: current.mobile?.hidden || block.mobile?.hidden || false } }));
              const blocks = [...layout.blocks]; blocks.splice(index, 1, ...added); onChange({ ...layout, blocks }); setSelected(added[0]?.id || "");
            } catch (e) { setError((e as Error).message); } finally { onBusyChange(false); }
          }}>转为独立副本</button></> : <>
        <label>模块标题<input value={current.title} maxLength={200} onChange={e => update({ title: e.target.value })} /></label>
        <label htmlFor={`block-text-${current.id}`}>模块说明</label>
        {current.html ? <div className="builder-rich-editor"><RichEditor value={current.html} onChange={html => update({ html })} disabled={disabled}
          onError={setError} onBusyChange={onBusyChange} wide={richWide} onWideChange={() => setRichWide(!richWide)} />
          <button type="button" className="secondary" onClick={() => {
            if (!confirm("转为纯文本会移除此模块的文字格式，可通过撤销恢复。是否继续？")) return;
            update({ html: "", text: new DOMParser().parseFromString(current.html, "text/html").body.textContent || "" });
          }}>转为纯文本</button></div> : <><textarea id={`block-text-${current.id}`} value={current.text} rows={3} maxLength={10000} onChange={e => update({ text: e.target.value })} />
          <button type="button" className="secondary" onClick={() => { const node = document.createElement("p"); node.textContent = current.text; update({ html: node.outerHTML }); }}>使用富文本排版</button></>}
        <div className="form-grid"><label>背景风格<select value={current.tone} onChange={e => update({ tone: e.target.value })}><option value="plain">页面底色</option><option value="soft">柔和底色</option><option value="accent">主题强调色</option></select></label>
          <label>文字对齐<select value={current.align} onChange={e => update({ align: e.target.value })}><option value="left">左对齐</option><option value="center">居中</option></select></label>
          <label>上下留白<select value={current.spacing} onChange={e => update({ spacing: e.target.value })}><option value="small">紧凑</option><option value="normal">标准</option><option value="large">宽松</option></select></label></div>
        <details className="builder-mobile-options"><summary>手机独立样式</summary>
          <label>手机文字对齐<select aria-label="手机文字对齐" value={current.mobile?.align || ""} onChange={e => mobileChange({ align: e.target.value })}>
            <option value="">跟随电脑</option><option value="left">左对齐</option><option value="center">居中</option></select></label>
          <label>手机上下留白<select aria-label="手机上下留白" value={current.mobile?.spacing || ""} onChange={e => mobileChange({ spacing: e.target.value })}>
            <option value="">自动适配</option><option value="small">紧凑</option><option value="normal">标准</option><option value="large">宽松</option></select></label>
          <label>手机文字大小<select aria-label="手机文字大小" value={current.mobile?.textSize || ""} onChange={e => mobileChange({ textSize: e.target.value })}>
            <option value="">跟随电脑</option><option value="small">较小</option><option value="normal">标准</option><option value="large">较大</option></select></label>
          {["cards", "posts"].includes(current.type) && <label>手机列数<select aria-label="手机列数" value={current.mobile?.columns || 1} onChange={e => mobileChange({ columns: Number(e.target.value) })}>
            <option value={1}>1 列</option><option value={2}>2 列</option></select></label>}
          <label className="checkbox-label"><input type="checkbox" checked={current.mobile?.hidden || false} onChange={e => mobileChange({ hidden: e.target.checked })} />仅在手机隐藏</label>
        </details>
        {["hero", "image"].includes(current.type) && imageFields(current, update, "模块")}
        {["hero", "text", "cta"].includes(current.type) && linkFields(current, update)}
        {["cards", "posts"].includes(current.type) && <label>桌面列数<select value={current.columns} onChange={e => update({ columns: Number(e.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} 列</option>)}</select><small>手机自动使用单列，平板最多两列。</small></label>}
        {current.type === "posts" && <><label>显示内容<select value={current.contentKind || "post"} onChange={e => update({ contentKind: e.target.value })}><option value="post">文章</option><option value="product">产品</option><option value="case">案例</option></select></label>
          <label>文章分类<select value={current.categoryId} disabled={terms.loading || !!terms.error} onChange={e => update({ categoryId: e.target.value })}><option value="">全部分类</option>{terms.data?.filter(x => x.kind === "category").map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>显示篇数<input type="number" min={1} max={12} value={current.limit} onChange={e => update({ limit: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} /></label><small>按首次发布时间倒序，自动展示已发布文章。</small></>}
        {["cards", "faq"].includes(current.type) && <div className="builder-items">{current.items.map((item, n) => <details key={n} open={current.items.length === 1 ? true : undefined}><summary>{n + 1}. {item.title || "未命名项目"}</summary>
          <label>项目标题<input value={item.title} maxLength={200} onChange={e => itemChange(n, { title: e.target.value })} /></label><label htmlFor={`item-text-${current.id}-${n}`}>项目说明</label><textarea id={`item-text-${current.id}-${n}`} value={item.text} maxLength={10000} rows={3} onChange={e => itemChange(n, { text: e.target.value })} />
          {current.type === "cards" && <>{imageFields(item, patch => itemChange(n, patch), `项目 ${n + 1}`)}{linkFields(item, patch => itemChange(n, patch))}</>}
          <div className="row-actions"><button type="button" className="secondary" disabled={n === 0} onClick={() => { const items = [...current.items]; [items[n - 1], items[n]] = [items[n], items[n - 1]]; update({ items }); }}>项目上移</button>
            <button type="button" className="danger secondary" onClick={() => update({ items: current.items.filter((_, i) => i !== n) })}>移除项目</button></div>
        </details>)}<button type="button" className="secondary" disabled={current.items.length >= 12} onClick={() => update({ items: [...current.items, newItem()] })}>添加项目（{current.items.length} / 12）</button></div>}
        {current.type === "contact" && <p className="muted">复用现有咨询表单，提交后进入客户咨询跟进。此页最多放置一个咨询模块。</p>}
        </>}
      </fieldset> : <p className="empty-state">从左侧添加模块，开始设计页面。</p>}</section>
    </div><LayoutPreview layout={layout} title={title} fields={fields} />
  </div>;
}
