import type { components } from "./api.generated";

// Responses include all properties; numeric values are serialized as JSON numbers.
type Schema<K extends keyof components["schemas"]> = Required<
  components["schemas"][K]
>;
export type User = Schema<"UserView"> & { role: "Admin" | "Editor" };
export type PageBlockItem = Required<components["schemas"]["PageBlockItem"]>;
export type PageBlock = Omit<Required<components["schemas"]["PageBlock"]>, "items" | "mobile"> & { items: PageBlockItem[]; mobile: Required<components["schemas"]["PageBlockMobile"]> | null };
export type PageLayout = Omit<Required<components["schemas"]["PageLayout"]>, "blocks"> & { blocks: PageBlock[] };
export type Content = Omit<Schema<"ContentView">, "layout"> & {
  kind: "post" | "page" | "template" | "block" | "product" | "case";
  version: number;
  layout: PageLayout | null;
};
export type Taxonomy = Schema<"Taxonomy"> & { kind: "category" | "tag" };
export type Asset = Schema<"AssetView"> & { size: number };
export type Comment = Schema<"Comment">;
export type Menu = Schema<"MenuView"> & { sort: number; version: number };
export type MenuTarget = Schema<"MenuTarget">;
export type Settings = Schema<"SettingsInput"> & { version: number; homePageSize: number; categoryPageSize: number; tagPageSize: number; searchPageSize: number };
export type AuditEntry = Schema<"AuditEntry">;
export type ThemeOptions = Schema<"ThemeOptions">;
export type ThemeView = Omit<Schema<"ThemeView">, "options"> & { options: ThemeOptions };
export type ThemeDefinition = Omit<Schema<"ThemeDefinition">, "options" | "defaults"> & { options: ThemeOptions; defaults: ThemeOptions };
export type ThemesView = Omit<Schema<"ThemesView">, "themes" | "version"> & { themes: ThemeDefinition[]; version: number };
export type Page<T> = Omit<Schema<"PageResultOfContentView">, "items"> & {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type Envelope<T> = Omit<Schema<"ApiResponseOfContentView">, "data"> & {
  data: T;
};
export const contentUrl = (content: Pick<Content, "kind" | "slug">) =>
  `/${editorSection(content.kind)}/${content.slug}`;
export const editorSection = (kind: Content["kind"]) => kind === "post" ? "posts" : kind === "template" ? "templates" : kind === "block" ? "blocks" : kind === "product" ? "products" : kind === "case" ? "cases" : "pages";
