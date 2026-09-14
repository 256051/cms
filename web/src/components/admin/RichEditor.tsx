"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Code2,
  Heading2,
  Link2,
  Table2,
  Undo2,
  Redo2,
  ImagePlus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Asset } from "@/lib/types";
import AssetSelector from "./AssetSelector";

export default function RichEditor({
  value,
  onChange,
  onError,
  disabled,
  onBusyChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onError: (v: string) => void;
  disabled: boolean;
  onBusyChange: (v: boolean) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [library, setLibrary] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false },
      }),
      Image,
      TableKit,
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        "aria-label": "正文编辑器",
        role: "textbox",
        "aria-multiline": "true",
        class: "prose",
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
  if (!editor) return <div className="loading">加载编辑器…</div>;
  const actions = [
    {
      label: "粗体",
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "二级标题",
      icon: Heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "无序列表",
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "引用",
      icon: Quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "代码块",
      icon: Code2,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "插入链接",
      icon: Link2,
      run: () => {
        const href = window.prompt("输入链接地址（HTTPS 或站内路径）");
        if (href) editor.chain().focus().setLink({ href }).run();
      },
    },
    {
      label: "插入表格",
      icon: Table2,
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      label: "撤销",
      icon: Undo2,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "重做",
      icon: Redo2,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div className="rich-editor">
      <div className="editor-toolbar" role="toolbar" aria-label="正文格式">
        {actions.map((a) => (
          <button
            type="button"
            className="icon-button"
            key={a.label}
            title={a.label}
            aria-label={a.label}
            onClick={a.run}
          >
            <a.icon size={18} />
          </button>
        ))}
        <button
          type="button"
          className="icon-button"
          title="上传并插入图片"
          aria-label="上传并插入图片"
          disabled={uploading}
          onClick={() => file.current?.click()}
        >
          <ImagePlus size={18} />
        </button>
        <input
          type="file"
          ref={file}
          hidden
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUploading(true);
            onBusyChange(true);
            try {
              const data = new FormData();
              data.append("file", f);
              const asset = await api<Asset>("admin/assets", "POST", data);
              editor
                .chain()
                .focus()
                .setImage({ src: asset.url, alt: f.name })
                .run();
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setUploading(false);
              onBusyChange(false);
              if (file.current) file.current.value = "";
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          onClick={() => setLibrary(!library)}
        >
          从附件库插入图片
        </button>
        {uploading && <span role="status">上传中…</span>}
      </div>
      {library && (
        <AssetSelector
          label="选择已有图片插入正文"
          value=""
          onChange={(id) => {
            if (id)
              editor
                .chain()
                .focus()
                .setImage({ src: `/media/${id}`, alt: "" })
                .run();
            setLibrary(false);
          }}
        />
      )}
      <EditorContent editor={editor} />
      <div className="editor-footnote">
        支持粘贴文本与格式 · 图片请使用上传按钮插入
      </div>
    </div>
  );
}
