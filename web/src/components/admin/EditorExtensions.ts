import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import Image from "@tiptap/extension-image";

export const EditorImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-width"),
        renderHTML: (a) => (a.width ? { "data-width": a.width } : {}),
      },
      align: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-align"),
        renderHTML: (a) => (a.align ? { "data-align": a.align } : {}),
      },
    };
  },
});

const media = (name: "video" | "audio") =>
  Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    addAttributes: () => ({ src: { default: "" }, title: { default: "" } }),
    parseHTML: () => [{ tag: name + "[src]" }],
    renderHTML: ({ HTMLAttributes }) => [
      name,
      mergeAttributes(HTMLAttributes, { controls: "", preload: "metadata" }),
    ],
  });
export const Video = media("video");
export const Audio = media("audio");
export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({
    src: { default: "" },
    title: { default: "嵌入网页" },
  }),
  parseHTML: () => [{ tag: 'iframe[data-type="embed"]' }],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "editor-embed-card";
      const caption = document.createElement("div");
      caption.className = "editor-embed-caption";
      const frame = document.createElement("iframe");
      frame.dataset.type = "embed";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.referrerPolicy = "no-referrer";
      frame.loading = "lazy";
      const update = (next: typeof node) => {
        if (next.type.name !== "embed") return false;
        caption.textContent = `${next.attrs.title || "嵌入网页"} · ${next.attrs.src}`;
        frame.title = next.attrs.title || "嵌入网页";
        if (frame.getAttribute("src") !== next.attrs.src)
          frame.setAttribute("src", next.attrs.src);
        return true;
      };
      dom.append(caption, frame);
      update(node);
      return { dom, update };
    };
  },
  renderHTML: ({ HTMLAttributes }) => [
    "iframe",
    mergeAttributes(HTMLAttributes, {
      "data-type": "embed",
      sandbox: "allow-scripts",
      referrerpolicy: "no-referrer",
      loading: "lazy",
    }),
  ],
});
export const Gallery = Node.create({
  name: "gallery",
  group: "block",
  content: "image+",
  isolating: true,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            // The required image+ schema creates an empty image after the last deletion.
            // Replace that empty gallery with a paragraph, including inside a column.
            if (
              node.type.name === "gallery" &&
              node.childCount === 1 &&
              !node.firstChild?.attrs.src
            )
              tr.replaceWith(
                tr.mapping.map(pos),
                tr.mapping.map(pos + node.nodeSize),
                state.schema.nodes.paragraph.create(),
              );
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
  addAttributes: () => ({
    columns: {
      default: "3",
      parseHTML: (el) => el.getAttribute("data-columns"),
      renderHTML: (a) => ({ "data-columns": a.columns }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-type="gallery"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "gallery" }),
    0,
  ],
});
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column column column?",
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="columns"]' }],
  renderHTML: ({ node }) => [
    "div",
    { "data-type": "columns", "data-columns": node.childCount },
    0,
  ],
});
export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="column"]' }],
  renderHTML: () => ["div", { "data-type": "column" }, 0],
});
