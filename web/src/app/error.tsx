"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <span className="eyebrow">暂时无法加载</span>
      <h1>连接遇到了一点问题</h1>
      <p>内容仍然保留，请稍后再试。</p>
      <button onClick={reset}>重新加载</button>
    </main>
  );
}
