import Link from "next/link";
export default function NotFound() {
  return (
    <main className="error-page">
      <span className="eyebrow">404 · 页面未找到</span>
      <h1>这一页暂时没有内容</h1>
      <p>它可能尚未发布，或已经被移除。</p>
      <Link className="button" href="/">
        返回首页
      </Link>
    </main>
  );
}
