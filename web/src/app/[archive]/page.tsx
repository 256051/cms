import { notFound } from "next/navigation";
export { BusinessArchive as default } from "@/components/PublicPages";

export async function generateMetadata({ params }: { params: Promise<{ archive: string }> }) {
  const { archive } = await params;
  if (archive !== "products" && archive !== "cases") notFound();
  return { title: archive === "products" ? "产品" : "案例" };
}
