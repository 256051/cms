"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder, CharacterCount } from "@tiptap/extensions";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code2,
  Code,
  Link2,
  Table2,
  Undo2,
  Redo2,
  ImagePlus,
  Plus,
  FolderOpen,
  Images,
  Film,
  Music,
  Globe,
  Columns3,
  Minus,
  Eraser,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Superscript as SupIcon,
  Subscript as SubIcon,
  PanelRight,
  Highlighter,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { api } from "@/lib/client";
import type { Asset } from "@/lib/types";
import EditorDialog from "./EditorDialog";
import EditorAssetPicker, { type InsertKind } from "./EditorAssetPicker";
import {
  EditorImage,
  Video,
  Audio,
  Embed,
  Gallery,
  Columns,
  Column,
} from "./EditorExtensions";

const accepts: Record<InsertKind, string> = {
  image: ".png,.jpg,.jpeg,.gif,.webp",
  gallery: ".png,.jpg,.jpeg,.gif,.webp",
  video: ".mp4,.webm",
  audio: ".mp3,.wav",
  file: ".png,.jpg,.jpeg,.gif,.webp,.pdf,.mp4,.webm,.mp3,.wav",
};
const names: Record<InsertKind, string> = {
  image: "图片",
  gallery: "图片集",
  video: "视频",
  audio: "音频",
  file: "附件",
};
// Saved CSS uses rgb/opaque rgba; a native color input requires six-digit hex.
function colorInputValue(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value))
    return "#" + [...value.slice(1)].map((x) => x + x).join("");
  const rgb = value.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*1(?:\.0+)?)?\s*\)$/i,
  );
  return rgb
    ? "#" +
        rgb
          .slice(1)
          .map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0"))
          .join("")
    : "#2563eb";
}
type Dialog =
  | InsertKind
  | "link"
  | "embed"
  | "imageOptions"
  | "table"
  | "columns";

export default function RichEditor({
  value,
  onChange,
  onError,
  disabled,
  onBusyChange,
  wide,
  onWideChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onError: (v: string) => void;
  disabled: boolean;
  onBusyChange: (v: boolean) => void;
  wide: boolean;
  onWideChange: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const uploadKind = useRef<InsertKind>("image");
  const uploadingRef = useRef(false);
  const uploadRef = useRef<(files: File[], kind: InsertKind) => void>(() => {});
  const slashKeys = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const [uploading, setUploading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [slash, setSlash] = useState(false);
  const [choice, setChoice] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState("");
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [imageWidth, setImageWidth] = useState("100");
  const [imageAlign, setImageAlign] = useState("center");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: false,
          HTMLAttributes: { target: null, rel: "noopener noreferrer" },
        },
      }),
      EditorImage,
      TableKit,
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      Placeholder.configure({ placeholder: "开始写作，输入 / 插入内容…" }),
      CharacterCount,
      Video,
      Audio,
      Embed,
      Gallery,
      Columns,
      Column,
    ],
    content: value,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
      const isSlash = editor.state.selection.$from.parent.textContent === "/";
      setSlash(isSlash);
      if (isSlash) setChoice(0);
    },
    editorProps: {
      scrollMargin: { top: 280, bottom: 45, left: 15, right: 15 },
      attributes: {
        "aria-label": "正文编辑器",
        role: "textbox",
        "aria-multiline": "true",
        class: "prose",
        "aria-describedby": "editor-help",
      },
      handleKeyDown: (_, e) => slashKeys.current(e),
      handlePaste: (_, e) => {
        const images = Array.from(e.clipboardData?.files || []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (!images.length) return false;
        e.preventDefault();
        uploadRef.current(images, "image");
        return true;
      },
      handleDrop: (view, e, _slice, moved) => {
        const images = Array.from(e.dataTransfer?.files || []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (moved || !images.length) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (pos) editor?.commands.setTextSelection(pos.pos);
        uploadRef.current(images, "image");
        return true;
      },
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    if (editor && editor.getHTML() !== value)
      editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (e: PointerEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !menuButton.current?.contains(e.target as Node)
      )
        setMenu(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  if (!editor) return <div className="loading">加载编辑器…</div>;
  const chain = () => editor.chain().focus();
  const close = () => {
    setDialog(null);
    editor.commands.focus();
  };
  const open = (kind: Dialog) => {
    setMenu(false);
    setSlash(false);
    setFormError("");
    setDialog(kind);
    setUrl("");
    setLabel("");
    if (kind === "link") setUrl(editor.getAttributes("link").href || "");
    if (kind === "embed" && editor.isActive("embed")) {
      setUrl(editor.getAttributes("embed").src);
      setLabel(editor.getAttributes("embed").title);
    }
    if (kind === "imageOptions") {
      const a = editor.getAttributes("image");
      setLabel(a.alt || "");
      setImageWidth(a.width || "100");
      setImageAlign(a.align || "center");
    }
  };
  const insertBlocks = (blocks: JSONContent[]) =>
    chain()
      .insertContent([...blocks, { type: "paragraph" }])
      .run();
  const insertAssets = (assets: Asset[], kind: InsertKind) => {
    const images = assets.map((a) => ({
      type: "image",
      attrs: { src: a.url, alt: a.name },
    }));
    if (kind === "gallery")
      insertBlocks([
        { type: "gallery", attrs: { columns: "3" }, content: images },
      ]);
    else if (kind === "image") insertBlocks(images);
    else if (kind === "video" || kind === "audio")
      insertBlocks(
        assets.map((a) => ({
          type: kind,
          attrs: { src: a.url, title: a.name },
        })),
      );
    else
      insertBlocks(
        assets.map((a) => ({
          type: "paragraph",
          content: [
            {
              type: "text",
              text: a.name,
              marks: [{ type: "link", attrs: { href: a.url } }],
            },
          ],
        })),
      );
    close();
  };
  const upload = async (files: File[], kind: InsertKind) => {
    if (disabled || uploadingRef.current || !files.length) return;
    if (files.length > 30) {
      onError("每次最多插入 30 个附件。");
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    onBusyChange(true);
    onError("");
    const assets: Asset[] = [];
    try {
      for (const f of files) {
        const data = new FormData();
        data.append("file", f);
        assets.push(await api<Asset>("admin/assets", "POST", data));
      }
    } catch (e) {
      onError(
        `${(e as Error).message}${assets.length ? ` 已成功上传的 ${assets.length} 个附件仍会插入。` : ""}`,
      );
    } finally {
      if (assets.length) insertAssets(assets, kind);
      uploadingRef.current = false;
      setUploading(false);
      onBusyChange(false);
      if (file.current) file.current.value = "";
    }
  };
  uploadRef.current = (files, kind) => {
    void upload(files, kind);
  };
  const chooseUpload = (kind: InsertKind) => {
    uploadKind.current = kind;
    if (file.current) {
      file.current.accept = accepts[kind];
      file.current.click();
    }
  };
  const inserts = [
    { label: "选择附件", icon: FolderOpen, run: () => open("file") },
    { label: "图片", icon: ImagePlus, run: () => open("image") },
    { label: "图片集", icon: Images, run: () => open("gallery") },
    { label: "视频", icon: Film, run: () => open("video") },
    { label: "音频", icon: Music, run: () => open("audio") },
    { label: "插入表格", icon: Table2, run: () => open("table") },
    { label: "嵌入网页", icon: Globe, run: () => open("embed") },
    {
      label: "代码块",
      icon: Code2,
      run: () => chain().toggleCodeBlock().run(),
    },
    { label: "分栏卡片", icon: Columns3, run: () => open("columns") },
    {
      label: "分隔线",
      icon: Minus,
      run: () => chain().setHorizontalRule().run(),
    },
  ];
  const chooseInsert = (index: number) => {
    if (slash) {
      const { $from } = editor.state.selection;
      if ($from.parent.textContent === "/")
        chain().deleteRange({ from: $from.start(), to: $from.end() }).run();
    }
    setSlash(false);
    setMenu(false);
    inserts[index].run();
  };
  slashKeys.current = (e) => {
    if (!slash) return false;
    if (e.key === "Escape") {
      setSlash(false);
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setChoice(
        (i) =>
          (i + (e.key === "ArrowDown" ? 1 : -1) + inserts.length) %
          inserts.length,
      );
      return true;
    }
    if (e.key === "Enter") {
      chooseInsert(choice);
      return true;
    }
    return false;
  };
  const tools = [
    {
      label: "粗体",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => chain().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => chain().toggleItalic().run(),
    },
    {
      label: "下划线",
      icon: Underline,
      active: editor.isActive("underline"),
      run: () => chain().toggleUnderline().run(),
    },
    {
      label: "删除线",
      icon: Strikethrough,
      active: editor.isActive("strike"),
      run: () => chain().toggleStrike().run(),
    },
    {
      label: "高亮",
      icon: Highlighter,
      active: editor.isActive("highlight"),
      run: () => chain().toggleHighlight({ color: "#fef08a" }).run(),
    },
    {
      label: "行内代码",
      icon: Code,
      active: editor.isActive("code"),
      run: () => chain().toggleCode().run(),
    },
    {
      label: "上标",
      icon: SupIcon,
      active: editor.isActive("superscript"),
      run: () => chain().unsetSubscript().toggleSuperscript().run(),
    },
    {
      label: "下标",
      icon: SubIcon,
      active: editor.isActive("subscript"),
      run: () => chain().unsetSuperscript().toggleSubscript().run(),
    },
    {
      label: "无序列表",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => chain().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => chain().toggleOrderedList().run(),
    },
    {
      label: "引用",
      icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => chain().toggleBlockquote().run(),
    },
    {
      label: "插入链接",
      icon: Link2,
      active: editor.isActive("link"),
      run: () => open("link"),
    },
  ];
  const attrs = editor.getAttributes("textStyle");
  const changeContainer = (name: string, unwrap: boolean) => {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name !== name) continue;
      const from = $from.before(depth);
      if (unwrap)
        chain()
          .insertContentAt(
            { from, to: from + node.nodeSize },
            node.toJSON().content,
          )
          .run();
      else
        chain()
          .deleteRange({ from, to: from + node.nodeSize })
          .run();
      break;
    }
  };
  return (
    <div className="rich-editor" aria-busy={uploading}>
      <div className="editor-tools">
        <div
          className="editor-toolbar"
          role="toolbar"
          aria-label="正文格式"
          onKeyDown={(e) => {
            if (
              !(e.target instanceof HTMLButtonElement) ||
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
            )
              return;
            const buttons = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            const index = buttons.indexOf(e.target);
            e.preventDefault();
            buttons[
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (e.key === "ArrowRight" ? 1 : -1) +
                      buttons.length) %
                    buttons.length
            ]?.focus();
          }}
        >
          <button
            ref={menuButton}
            type="button"
            className="editor-insert-button"
            aria-haspopup="menu"
            aria-expanded={menu || slash}
            aria-controls="editor-insert-menu"
            disabled={disabled}
            onClick={() => {
              setSlash(false);
              setMenu(!menu);
            }}
          >
            <Plus size={18} />
            插入
          </button>
          <button
            type="button"
            className="icon-button"
            title="撤销 Ctrl+Z"
            aria-label="撤销"
            disabled={disabled || !editor.can().undo()}
            onClick={() => chain().undo().run()}
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="重做 Ctrl+Shift+Z"
            aria-label="重做"
            disabled={disabled || !editor.can().redo()}
            onClick={() => chain().redo().run()}
          >
            <Redo2 size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="清除格式"
            aria-label="清除格式"
            disabled={disabled}
            onClick={() => chain().unsetAllMarks().clearNodes().run()}
          >
            <Eraser size={18} />
          </button>
          <span className="editor-tool-divider" />
          <select
            aria-label="段落样式"
            title="段落样式"
            disabled={disabled}
            value={
              editor.isActive("heading")
                ? String(editor.getAttributes("heading").level)
                : "p"
            }
            onChange={(e) =>
              e.target.value === "p"
                ? chain().setParagraph().run()
                : chain()
                    .setHeading({ level: Number(e.target.value) as 2 | 3 | 4 })
                    .run()
            }
          >
            <option value="p">正文</option>
            <option value="2">二级标题</option>
            <option value="3">三级标题</option>
            <option value="4">四级标题</option>
          </select>
          <select
            aria-label="字体"
            title="字体"
            disabled={disabled}
            value={attrs.fontFamily || ""}
            onChange={(e) =>
              e.target.value
                ? chain().setFontFamily(e.target.value).run()
                : chain().unsetFontFamily().run()
            }
          >
            <option value="">默认字体</option>
            <option value="system-ui">系统字体</option>
            <option value="serif">衬线字体</option>
            <option value="monospace">等宽字体</option>
          </select>
          <select
            aria-label="字号"
            title="字号"
            disabled={disabled}
            value={attrs.fontSize || ""}
            onChange={(e) =>
              e.target.value
                ? chain().setFontSize(e.target.value).run()
                : chain().unsetFontSize().run()
            }
          >
            <option value="">字号</option>
            {[12, 14, 16, 18, 20, 24, 28, 32, 36, 40].map((n) => (
              <option key={n} value={`${n}px`}>
                {n}
              </option>
            ))}
          </select>
          {tools.map((t) => (
            <button
              type="button"
              className="icon-button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={t.active}
              key={t.label}
              disabled={disabled}
              onClick={t.run}
            >
              <t.icon size={18} />
            </button>
          ))}
          <label className="editor-color" title="文字颜色">
            <span>文字颜色</span>
            <input
              aria-label="文字颜色"
              type="color"
              value={colorInputValue(attrs.color || "")}
              disabled={disabled}
              onChange={(e) => chain().setColor(e.target.value).run()}
            />
          </label>
          <span className="editor-tool-divider" />
          {(
            [
              ["left", "左对齐", AlignLeft],
              ["center", "居中", AlignCenter],
              ["right", "右对齐", AlignRight],
              ["justify", "两端对齐", AlignJustify],
            ] as const
          ).map(([align, name, Icon]) => (
            <button
              key={align}
              type="button"
              className="icon-button"
              title={name}
              aria-label={name}
              aria-pressed={editor.isActive({ textAlign: align })}
              disabled={disabled}
              onClick={() => chain().setTextAlign(align).run()}
            >
              <Icon size={18} />
            </button>
          ))}
          <select
            aria-label="行距"
            title="行距"
            disabled={disabled}
            value={attrs.lineHeight || ""}
            onChange={(e) =>
              e.target.value
                ? chain().setLineHeight(e.target.value).run()
                : chain().unsetLineHeight().run()
            }
          >
            <option value="">行距</option>
            {[1.2, 1.5, 1.75, 2, 2.5].map((n) => (
              <option key={n} value={String(n)}>
                {n} 倍
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button"
            title="上传并插入图片"
            aria-label="上传并插入图片"
            disabled={disabled}
            onClick={() => chooseUpload("image")}
          >
            <ImagePlus size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={wide ? "显示发布设置" : "收起发布设置"}
            aria-label={wide ? "显示发布设置" : "收起发布设置"}
            aria-pressed={wide}
            onClick={onWideChange}
          >
            <PanelRight size={18} />
          </button>
        </div>
        {(menu || slash) && (
          <div
            ref={menuRef}
            id="editor-insert-menu"
            className="editor-insert-menu"
            role="menu"
            aria-label="插入内容"
            onKeyDown={(e) => {
              const buttons = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
              );
              const i = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(false);
                setSlash(false);
                menuButton.current?.focus();
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                buttons[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (i +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length
                ]?.focus();
              }
              if (e.key === "Tab") {
                setMenu(false);
                setSlash(false);
              }
            }}
          >
            {inserts.map((item, i) => (
              <button
                type="button"
                role="menuitem"
                key={item.label}
                className={slash && choice === i ? "selected" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseInsert(i)}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
            {slash && (
              <small role="status">
                {inserts[choice].label} · ↑↓ 选择 · Enter 插入 · Esc 关闭
              </small>
            )}
          </div>
        )}
        <input
          type="file"
          ref={file}
          hidden
          multiple
          accept={accepts.image}
          onChange={(e) => {
            void upload(Array.from(e.target.files || []), uploadKind.current);
          }}
        />
        <div className="editor-contextbar">
          <button
            type="button"
            className="editor-text-button"
            disabled={disabled}
            onClick={() => open("image")}
          >
            从附件库插入图片
          </button>
          {editor.isActive("link") && (
            <button
              type="button"
              className="editor-text-button"
              onClick={() => chain().extendMarkRange("link").unsetLink().run()}
            >
              移除链接
            </button>
          )}
          {editor.isActive("image") && (
            <button
              type="button"
              className="editor-text-button"
              onClick={() => open("imageOptions")}
            >
              图片设置
            </button>
          )}
          {editor.isActive("embed") && (
            <button
              type="button"
              className="editor-text-button"
              onClick={() => open("embed")}
            >
              编辑嵌入网页
            </button>
          )}
          {["image", "video", "audio", "embed"].some((n) =>
            editor.isActive(n),
          ) && (
            <button
              type="button"
              className="editor-text-button"
              onClick={() => chain().deleteSelection().run()}
            >
              移除选中媒体
            </button>
          )}
          {editor.isActive("gallery") && (
            <>
              <button
                type="button"
                className="editor-text-button"
                onClick={() =>
                  chain()
                    .updateAttributes("gallery", {
                      columns:
                        editor.getAttributes("gallery").columns === "2"
                          ? "3"
                          : "2",
                    })
                    .run()
                }
              >
                切换图片集列数
              </button>
              <button
                type="button"
                className="editor-text-button"
                onClick={() => changeContainer("gallery", true)}
              >
                解散图片集
              </button>
            </>
          )}
          {editor.isActive("columns") && (
            <button
              type="button"
              className="editor-text-button"
              onClick={() => changeContainer("columns", false)}
            >
              删除分栏
            </button>
          )}
          {editor.isActive("codeBlock") && (
            <label>
              代码语言
              <select
                aria-label="代码语言"
                value={editor.getAttributes("codeBlock").language || ""}
                onChange={(e) =>
                  chain()
                    .updateAttributes("codeBlock", {
                      language: e.target.value || null,
                    })
                    .run()
                }
              >
                <option value="">纯文本</option>
                {[
                  "csharp",
                  "javascript",
                  "typescript",
                  "json",
                  "html",
                  "css",
                  "python",
                  "sql",
                  "bash",
                ].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          )}
          {uploading && <span role="status">正在上传，请稍候…</span>}
        </div>
        {editor.isActive("table") && (
          <div className="editor-contextbar" aria-label="表格操作">
            {(
              [
                [
                  "上方插入行",
                  (e: Editor) => e.chain().focus().addRowBefore().run(),
                ],
                [
                  "下方插入行",
                  (e: Editor) => e.chain().focus().addRowAfter().run(),
                ],
                [
                  "左侧插入列",
                  (e: Editor) => e.chain().focus().addColumnBefore().run(),
                ],
                [
                  "右侧插入列",
                  (e: Editor) => e.chain().focus().addColumnAfter().run(),
                ],
                ["删除行", (e: Editor) => e.chain().focus().deleteRow().run()],
                [
                  "删除列",
                  (e: Editor) => e.chain().focus().deleteColumn().run(),
                ],
                [
                  "合并单元格",
                  (e: Editor) => e.chain().focus().mergeCells().run(),
                ],
                [
                  "拆分单元格",
                  (e: Editor) => e.chain().focus().splitCell().run(),
                ],
                [
                  "切换表头",
                  (e: Editor) => e.chain().focus().toggleHeaderRow().run(),
                ],
                [
                  "删除表格",
                  (e: Editor) => e.chain().focus().deleteTable().run(),
                ],
              ] as const
            ).map(([name, run]) => (
              <button
                type="button"
                className="editor-text-button"
                key={name}
                disabled={
                  disabled ||
                  (name === "合并单元格" && !editor.can().mergeCells()) ||
                  (name === "拆分单元格" && !editor.can().splitCell())
                }
                onClick={() => run(editor)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      <EditorContent editor={editor} />
      <div className="editor-footnote" id="editor-help">
        <span>{editor.storage.characterCount.characters()} 字符</span>
        <span>支持图片粘贴、拖入 · / 插入 · Ctrl / ⌘ + S 保存草稿</span>
      </div>
      {dialog && (
        <EditorDialog
          title={
            dialog in names
              ? `插入${names[dialog as InsertKind]}`
              : (
                  {
                    link: "链接设置",
                    embed: "嵌入网页",
                    imageOptions: "图片设置",
                    table: "插入表格",
                    columns: "分栏卡片",
                  } as Record<string, string>
                )[dialog]
          }
          close={close}
        >
          {dialog in names ? (
            <EditorAssetPicker
              kind={dialog as InsertKind}
              insert={(a) => insertAssets(a, dialog as InsertKind)}
              upload={() => {
                const kind = dialog as InsertKind;
                close();
                chooseUpload(kind);
              }}
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setFormError("");
                if (dialog === "link") {
                  const href = url.trim();
                  if (!href) chain().extendMarkRange("link").unsetLink().run();
                  else if (
                    !/^(https?:\/\/[^\s]+|mailto:[^\s]+|\/(?![\/\\])[^\s\\]*|#[^\s]+)$/i.test(
                      href,
                    )
                  ) {
                    setFormError("请输入 HTTP(S)、邮件地址、站内路径或锚点。");
                    return;
                  } else if (
                    editor.state.selection.empty &&
                    !editor.isActive("link")
                  )
                    chain()
                      .insertContent({
                        type: "text",
                        text: label.trim() || href,
                        marks: [{ type: "link", attrs: { href } }],
                      })
                      .run();
                  else chain().extendMarkRange("link").setLink({ href }).run();
                }
                if (dialog === "embed") {
                  try {
                    const u = new URL(url.trim());
                    if (
                      u.protocol !== "https:" ||
                      u.username ||
                      u.password ||
                      (u.port && u.port !== "443") ||
                      !u.hostname.includes(".") ||
                      /^[\d.]+$/.test(u.hostname) ||
                      u.hostname.includes(":") ||
                      /\.(localhost|local|internal|lan|home)$/i.test(u.hostname)
                    )
                      throw new Error();
                  } catch {
                    setFormError("请输入公开域名的 HTTPS 网页地址。");
                    return;
                  }
                  if (editor.isActive("embed"))
                    chain()
                      .updateAttributes("embed", {
                        src: url.trim(),
                        title: label.trim() || "嵌入网页",
                      })
                      .run();
                  else
                    insertBlocks([
                      {
                        type: "embed",
                        attrs: {
                          src: url.trim(),
                          title: label.trim() || "嵌入网页",
                        },
                      },
                    ]);
                }
                if (dialog === "imageOptions")
                  chain()
                    .updateAttributes("image", {
                      alt: label,
                      width: imageWidth,
                      align: imageAlign,
                    })
                    .run();
                if (dialog === "table")
                  chain()
                    .insertTable({ rows, cols, withHeaderRow: true })
                    .run();
                if (dialog === "columns")
                  insertBlocks([
                    {
                      type: "columns",
                      content: Array.from(
                        { length: cols === 2 ? 2 : 3 },
                        () => ({
                          type: "column",
                          content: [{ type: "paragraph" }],
                        }),
                      ),
                    },
                  ]);
                close();
              }}
            >
              {(dialog === "link" || dialog === "embed") && (
                <>
                  <label>
                    {dialog === "embed" ? "网页地址" : "链接地址"}
                    <input
                      autoFocus
                      type="text"
                      inputMode="url"
                      maxLength={2000}
                      required={dialog === "embed"}
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                  <label>
                    {dialog === "embed"
                      ? "网页标题"
                      : "链接文字（未选择文字时使用）"}
                    <input
                      maxLength={150}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    {dialog === "embed"
                      ? "仅支持公开 HTTPS 网页；对方禁止嵌入时浏览器无法显示。框架不允许登录、表单、弹窗或跳转当前页面。"
                      : "选中文字后可设置或修改链接；清空地址可移除链接。"}
                  </p>
                </>
              )}
              {dialog === "imageOptions" && (
                <>
                  <label>
                    图片说明
                    <input
                      autoFocus
                      maxLength={200}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </label>
                  <label>
                    图片宽度
                    <select
                      value={imageWidth}
                      onChange={(e) => setImageWidth(e.target.value)}
                    >
                      {[25, 50, 75, 100].map((n) => (
                        <option value={String(n)} key={n}>
                          {n}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    图片对齐
                    <select
                      value={imageAlign}
                      onChange={(e) => setImageAlign(e.target.value)}
                    >
                      <option value="left">左对齐</option>
                      <option value="center">居中</option>
                      <option value="right">右对齐</option>
                    </select>
                  </label>
                </>
              )}
              {dialog === "table" && (
                <>
                  <label>
                    行数
                    <input
                      autoFocus
                      type="number"
                      min={1}
                      max={20}
                      value={rows}
                      onChange={(e) => setRows(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    列数
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={cols}
                      onChange={(e) => setCols(Number(e.target.value))}
                    />
                  </label>
                  <p className="muted">
                    首行为表头，选中单元格后可增删行列、合并或拆分。拖选多个单元格后合并。
                  </p>
                </>
              )}
              {dialog === "columns" && (
                <>
                  <label>
                    分栏数量
                    <select
                      autoFocus
                      value={cols === 2 ? 2 : 3}
                      onChange={(e) => setCols(Number(e.target.value))}
                    >
                      <option value={2}>两栏</option>
                      <option value={3}>三栏</option>
                    </select>
                  </label>
                  <p className="muted">
                    每栏独立编辑，手机上自动改为单列显示。
                  </p>
                </>
              )}
              {formError && (
                <p role="alert" className="alert">
                  {formError}
                </p>
              )}
              <div className="editor-dialog-actions">
                <button type="button" className="secondary" onClick={close}>
                  取消
                </button>
                <button type="submit">确定</button>
              </div>
            </form>
          )}
        </EditorDialog>
      )}
    </div>
  );
}
