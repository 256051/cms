"use client";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  LayoutDashboard,
  FileText,
  Files,
  Tags,
  ImageIcon,
  MessageSquare,
  Settings,
  Users,
  List,
  Link as LinkIcon,
  LogOut,
  ArrowUpRight,
  ShieldCheck,
  Menu as MenuIcon,
  X,
  LockKeyhole,
  Palette,
  ChevronDown,
} from "lucide-react";
import { api, ApiError, resetCsrf } from "@/lib/client";
import { confirmNavigation, discardChanges } from "./unsaved";
import type { User } from "@/lib/types";
import type { components } from "@/lib/api.generated";
import { Heading, Loading, Notice, useLoad, LoadState } from "./shared";
import InquiryFormManager from "./InquiryFormManager";
import NotificationManager from "./NotificationManager";
import { PaymentSettings, CommerceProducts, CommerceOrders } from "./CommerceManager";
import ContentManager from "./ContentManager";
import ContentEditor from "./ContentEditor";
import LayoutPreview from "./LayoutPreview";
import BusinessDetails from "../BusinessDetails";
import MaintenanceManager, { OperationsReminder } from "./MaintenanceManager";
import ThemeManager from "./ThemeManager";
import MenuManager from "./MenuManager";
import SettingsManager from "./SettingsManager";
import WeChatSettingsManager from "./WeChatSettingsManager";
import AiSettingsManager from "./AiSettingsManager";
import TokenManager from "./TokenManager";
import { TrafficOverview, VisitorManager, LeadManager } from "./TrafficManagement";
import {
  AssetManager,
  TaxonomyManager,
  CommentManager,
  UserManager,
  AuditManager,
  PasswordManager,
} from "./Management";

const navigationGroups: { label: string; items: [string, string, typeof FileText, boolean?][] }[] = [
  { label: "内容管理", items: [
    ["posts", "文章", FileText], ["pages", "独立页面", Files],
    ["products", "产品", Files], ["cases", "案例", Files], ["taxonomy", "分类与标签", Tags],
  ] },
  { label: "设计与素材", items: [
    ["templates", "页面模板", Files], ["blocks", "公共区块", Files], ["assets", "附件库", ImageIcon],
    ["menu", "导航菜单", List, true], ["themes", "主题外观", Palette, true],
    ["friend-links", "友情链接", LinkIcon, true],
  ] },
  { label: "客户运营", items: [
    ["comments", "评论", MessageSquare], ["leads", "客户咨询", MessageSquare, true],
    ["inquiry-form", "咨询表单", FileText, true],
  ] },
  { label: "数据统计", items: [
    ["traffic", "访问统计", LayoutDashboard, true], ["visitors", "访客记录", Users, true],
  ] },
  { label: "系统管理", items: [
    ["settings", "站点设置", Settings, true], ["users", "成员与权限", Users, true],
    ["wechat", "公众号设置", MessageSquare, true],
    ["ai", "AI 写作设置", FileText, true],
    ["access-tokens", "API 访问令牌", LockKeyhole, true], ["maintenance", "备份与维护", ShieldCheck, true],
    ["notifications", "通知记录", MessageSquare, true], ["audit", "操作记录", ShieldCheck, true],
  ] },
  { label: "商品交易", items: [
    ["commerce-products", "商品销售", Files, true], ["commerce-orders", "交易订单", List, true], ["payments", "支付设置", Settings, true],
  ] },
];
export default function AdminApp({ route }: { route: string[] }) {
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const [small, setSmall] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const path = route.join("/");
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const change = () => {
      setSmall(query.matches);
      if (!query.matches) setMobile(false);
    };
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!mobile || !small) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    return () => {
      document.body.style.overflow = previous;
      toggle.current?.focus();
    };
  }, [mobile, small]);
  useEffect(() => {
    setMobile(false);
    if (path === "login") {
      setLoading(false);
      return;
    }
    api<User>("auth/me")
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401)
          window.location.replace("/admin/login");
        else setError((e as Error).message);
      })
      .finally(() => setLoading(false));
  }, [path]);
  if (path === "login") return <Login />;
  if (loading) return <Loading />;
  if (!user)
    return (
      <main className="admin-main">
        <Notice error={error} />
        <LoadState loading={false} error={error} retry={() => window.location.reload()} />
      </main>
    );
  const section = route[0] || "";
  const currentGroup = navigationGroups.find(group => group.items.some(item => item[0] === section));
  const title = section === "" ? "概览" : currentGroup?.items.find(item => item[0] === section)?.[1] || "内容编辑";
  return (
    <div className="admin-layout">
      <a className="skip-link" href="#admin-main" inert={small && mobile}>
        跳到内容
      </a>
      <button
        ref={toggle}
        inert={small && mobile}
        style={small && mobile ? { visibility: "hidden" } : undefined}
        aria-expanded={mobile}
        aria-controls="admin-navigation"
        className="mobile-toggle secondary"
        aria-label={mobile ? "关闭导航" : "打开导航"}
        onClick={() => setMobile(!mobile)}
      >
        {mobile ? <X /> : <MenuIcon />}
      </button>
      {mobile && (
        <button
          className="nav-scrim"
          tabIndex={-1}
          aria-hidden="true"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="admin-navigation"
        className={`sidebar ${mobile ? "open" : ""}`}
        inert={small && !mobile}
        role={small && mobile ? "dialog" : undefined}
        aria-modal={small && mobile ? true : undefined}
        aria-label="管理导航"
        onKeyDown={(event) => {
          if (!small || !mobile) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setMobile(false);
          }
          if (event.key === "Tab") {
            const items = Array.from(
              sidebar.current?.querySelectorAll<HTMLElement>(
                "a[href], button:not(:disabled), summary",
              ) || [],
            ).filter(item => item.getClientRects().length > 0);
            const first = items[0],
              last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        {small && mobile && (
          <button
            className="nav-close secondary"
            aria-label="关闭导航"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        )}
        <a href="/admin" className="brand">
          <span className="brand-icon">
            <BookOpen size={22} />
          </span>
          <span>
            内容工作台<small>CONTENT STUDIO</small>
          </span>
        </a>
        <nav aria-label="内容管理导航">
          <a href="/admin" className={section === "" ? "selected" : ""} aria-current={section === "" ? "page" : undefined}>
            <LayoutDashboard size={19} aria-hidden="true" />{user.role === "Support" ? "我的待办" : "概览"}
          </a>
          {navigationGroups.map(group => {
            const items = group.items.filter(item => user.role === "Support" ? item[0] === "leads" : !item[3] || user.role === "Admin");
            if (!items.length) return null;
            return <details className="nav-group" key={group.label} open={currentGroup === group || (section === "" && group === navigationGroups[0])}>
              <summary>{group.label}<ChevronDown size={16} aria-hidden="true" /></summary>
              <div className="nav-group-links">{items.map(([href, label, Icon]) => (
                <a href={"/admin/" + href} className={section === href ? "selected" : ""}
                  aria-current={section === href ? "page" : undefined} key={href}>
                  <Icon size={19} aria-hidden="true" />{label}
                </a>
              ))}</div>
            </details>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <a href="/" target="_blank">
            访问网站 <ArrowUpRight size={16} />
          </a>
          <div className="user-card">
            <span className="avatar">{user.displayName.slice(0, 1)}</span>
            <div>
              <strong>{user.displayName}</strong>
              <small>{user.role === "Admin" ? "管理员" : user.role === "Support" ? "咨询专员" : "内容编辑"}</small>
            </div>
            <a href="/admin/password" aria-label="修改密码">
              <LockKeyhole size={17} />
            </a>
          </div>
        </div>
      </aside>
      <div className="admin-workspace" inert={small && mobile}>
        <header className="admin-topbar">
          <span>
            {currentGroup?.label || "工作空间"} <span className="breadcrumb-separator">/</span>{" "}
            <strong>{title}</strong>
          </span>
          <div>
            <span className="workspace-status">
              <span className="dot" /> 独立站点
            </span>
            <button
              className="icon-button"
              title="退出登录"
              aria-label="退出登录"
              onClick={async () => {
                try {
                  if (!confirmNavigation()) return;
                  await api("auth/logout", "POST");
                  discardChanges();
                  resetCsrf();
                  window.location.assign("/admin/login");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="admin-main" id="admin-main">
          <Notice error={error} />
          {user.role === "Admin" && <OperationsReminder />}
          {user.role === "Support" ? (
            section === "" || section === "leads" ? <LeadManager user={user} /> : section === "password" ? <PasswordManager /> : <p role="alert">此账号仅可处理分配给自己的咨询。</p>
          ) : section === "" ? (
            <Dashboard user={user} />
          ) : section === "posts" || section === "pages" || section === "templates" || section === "blocks" || section === "products" || section === "cases" ? (
            route.length > 1 ? (
              <ContentEditor
                key={path}
                userId={user.id}
                kind={section === "posts" ? "post" : section === "templates" ? "template" : section === "blocks" ? "block" : section === "products" ? "product" : section === "cases" ? "case" : "page"}
                id={route[1] === "new" ? undefined : route[1]}
              />
            ) : (
              <ContentManager kind={section === "posts" ? "post" : section === "templates" ? "template" : section === "blocks" ? "block" : section === "products" ? "product" : section === "cases" ? "case" : "page"} />
            )
          ) : section === "preview" ? (
            <Preview id={route[1]} />
          ) : section === "taxonomy" ? (
            <TaxonomyManager />
          ) : section === "assets" ? (
            <AssetManager />
          ) : section === "comments" ? (
            <CommentManager user={user} />
          ) : section === "password" ? (
            <PasswordManager />
          ) : user.role === "Admin" ? (
            section === "ai" ? <AiSettingsManager /> : section === "wechat" ? <WeChatSettingsManager /> : section === "payments" ? <PaymentSettings /> : section === "commerce-products" ? <CommerceProducts id={route[1]} /> : section === "commerce-orders" ? <CommerceOrders /> : section === "inquiry-form" ? <InquiryFormManager /> : section === "notifications" ? <NotificationManager /> : section === "maintenance" ? <MaintenanceManager /> : section === "traffic" ? <TrafficOverview /> : section === "visitors" ? <VisitorManager initialId={route[1]} /> : section === "leads" ? <LeadManager user={user} /> : section === "themes" ? (
              <ThemeManager />
            ) : section === "settings" ? (
              <SettingsManager />
            ) : section === "menu" ? (
              <MenuManager />
            ) : section === "friend-links" ? (
              <MenuManager friendLinks />
            ) : section === "users" ? (
              <UserManager />
            ) : section === "access-tokens" ? (
              <TokenManager user={user} />
            ) : section === "audit" ? (
              <AuditManager />
            ) : (
              <p>页面不存在。</p>
            )
          ) : (
            <p role="alert">此页面需要管理员权限。</p>
          )}
        </main>
      </div>
    </div>
  );
}
function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<components["schemas"]["CaptchaView"] | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false), [captchaError, setCaptchaError] = useState("");
  const [retryIn, setRetryIn] = useState(0);
  const captchaInput = useRef<HTMLInputElement>(null), captchaRequest = useRef(0);
  async function refreshCaptcha() {
    const request = ++captchaRequest.current;
    setCaptchaLoading(true); setCaptcha(null); setCaptchaError("");
    if (captchaInput.current) captchaInput.current.value = "";
    try {
      const next = await api<components["schemas"]["CaptchaView"]>("auth/captcha");
      if (request === captchaRequest.current) setCaptcha(next);
    } catch (e) {
      if (request === captchaRequest.current) setCaptchaError((e as Error).message);
    } finally { if (request === captchaRequest.current) setCaptchaLoading(false); }
  }
  useEffect(() => { void refreshCaptcha(); return () => { captchaRequest.current++; }; }, []);
  useEffect(() => {
    if (!retryIn) return;
    const timer = window.setTimeout(() => setRetryIn(retryIn - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [retryIn]);
  return (
    <main className="login-page">
      <section className="login-story">
        <a href="/" className="brand">
          <BookOpen /> 内容工作台
        </a>
        <div>
          <span className="eyebrow">YOUR WORDS MATTER</span>
          <h1>
            好内容，
            <br />
            从这里开始。
          </h1>
          <p>把灵感变成文章，让每一份思考找到读者。</p>
        </div>
        <small>一个专注于创作的空间。</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>登录工作台</h2>
          <p className="muted">使用管理员为你创建的账号登录。</p>
          <Notice error={error} />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!captcha || busy || captchaLoading || retryIn) return;
              setBusy(true);
              setError("");
              const data = new FormData(e.currentTarget);
              try {
                await api("auth/login", "POST", {
                  username: data.get("username"),
                  password: data.get("password"),
                  captchaId: captcha.id,
                  captchaCode: data.get("captchaCode"),
                });
                resetCsrf();
                window.location.assign("/admin");
              } catch (e) {
                setError((e as Error).message);
                if (e instanceof ApiError && e.status === 429) setRetryIn(Math.min(e.retryAfterSeconds || 60, 900));
                await refreshCaptcha();
                captchaInput.current?.focus();
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              账号
              <input
                name="username"
                required
                autoComplete="username"
                autoFocus
                maxLength={64}
              />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={200}
              />
            </label>
            <label htmlFor="login-captcha">验证码</label>
            <div className="captcha-image-row" aria-busy={captchaLoading}>
              {captcha ? <img src={captcha.image} width={200} height={64} alt="登录验证码图片" onError={() => { setCaptcha(null); setCaptchaError("验证码图片加载失败，请点击换一张重试。"); }} /> : <span className="captcha-placeholder" role="status">{captchaLoading ? "正在加载验证码…" : "验证码未加载"}</span>}
              <button className="secondary captcha-refresh" type="button" disabled={busy || captchaLoading} onClick={() => { void refreshCaptcha().then(() => captchaInput.current?.focus()); }}>换一张</button>
            </div>
            <input id="login-captcha" name="captchaCode" ref={captchaInput} required inputMode="numeric" pattern="[2-9]{6}" minLength={6} maxLength={6} autoComplete="off" placeholder="输入图片中的 6 位数字" aria-describedby="captcha-help captcha-error" aria-invalid={!!captchaError} />
            <small id="captcha-help">验证码 3 分钟内有效，每次提交后需重新输入。</small>
            <div id="captcha-error" role="alert" className="captcha-error">{captchaError}</div>
            {retryIn > 0 && <p className="muted">尝试过于频繁，请在 {retryIn} 秒后重试。</p>}
            <button disabled={busy || captchaLoading || !captcha || retryIn > 0}>
              {busy ? "正在登录…" : "登录工作台"} <ArrowUpRight size={17} />
            </button>
          </form>
          <p className="login-help">没有账号或忘记密码？请联系站点管理员。</p>
          <a href="/" className="muted">
            ← 返回网站
          </a>
        </div>
      </section>
    </main>
  );
}
function Dashboard({ user }: { user: User }) {
  const { data, error, loading, reload } = useLoad<{
    posts: number;
    published: number;
    pages: number;
    pendingComments: number;
    assets: number;
  }>("admin/stats");
  return (
    <>
      <Heading
        title={`你好，${user.displayName}`}
        description="从一个想法开始，继续你的创作。"
      >
        <a href="/admin/posts/new" className="button">
          ＋ 写文章
        </a>
      </Heading>
      <Notice error={error} />
      <LoadState loading={loading} error={error} retry={reload} />
      <section className="welcome-banner">
        <div>
          <span className="eyebrow">MAKE SOMETHING WORTH READING</span>
          <h2>
            你的下一篇好内容，
            <br />
            就在下一次落笔。
          </h2>
          <p>管理文章、整理素材，把值得分享的想法发布出去。</p>
          <a href="/admin/posts/new">
            开始创作 <ArrowUpRight size={17} />
          </a>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="paper">
            <FileText size={35} strokeWidth={1} />
            <i />
            <i />
            <i />
            <span>Ideas come to life.</span>
          </div>
        </div>
      </section>
      <div className="stats-grid">
        {[
          ["文章总数", data?.posts, FileText],
          ["已发布内容", data?.published, BookOpen],
          ["待审核评论", data?.pendingComments, MessageSquare],
          ["附件总数", data?.assets, ImageIcon],
        ].map(([label, count, Icon]) => {
          const I = Icon as typeof FileText;
          return (
            <div className="stat-card" key={String(label)}>
              <span>
                {String(label)}
                <I size={19} />
              </span>
              <strong>{count === undefined ? "—" : String(count)}</strong>
              <small>当前站点</small>
            </div>
          );
        })}
      </div>
      {user.role === "Admin" && <TrafficOverview compact />}
      <div className="dashboard-panels">
        <section className="panel">
          <h2>创作流程</h2>
          {[
            ["01", "整理想法", "创建文章或独立页面，保存为草稿。"],
            ["02", "完善内容", "添加图片、分类和标签，预览最终效果。"],
            ["03", "发布分享", "确认内容后发布，立即在网站中呈现。"],
          ].map(([n, title, text]) => (
            <div className="workflow-step" key={n}>
              <span>{n}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>快捷入口</h2>
          <a className="quick-link" href="/admin/assets">
            <ImageIcon />
            <div>
              <strong>整理附件</strong>
              <span>上传图片，让文章更生动</span>
            </div>
            <ArrowUpRight />
          </a>
          <a className="quick-link" href="/admin/comments">
            <MessageSquare />
            <div>
              <strong>查看评论</strong>
              <span>与读者保持交流</span>
            </div>
            <ArrowUpRight />
          </a>
          <a className="quick-link" href="/" target="_blank">
            <BookOpen />
            <div>
              <strong>浏览网站</strong>
              <span>看看读者眼中的内容</span>
            </div>
            <ArrowUpRight />
          </a>
        </section>
      </div>
    </>
  );
}
function Preview({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad<import("@/lib/types").Content>(
    "admin/contents/" + id,
  );
  return (
    <>
      <Heading
        title="草稿预览"
        description="仅登录用户可见；保存草稿不会自动发布。"
      />
      <Notice error={error} />
      <LoadState loading={loading} error={error} retry={reload} />
      {data?.layout ? <LayoutPreview layout={data.layout} title={data.title} fields={data.fields} /> : data && (
        <article className="panel reading">
          <h1>{data.title}</h1>
          <p className="reading-summary">{data.summary}</p>
          <BusinessDetails fields={data.fields} />
          {data.coverId && (
            <img
              className="reading-cover"
              src={"/media/" + data.coverId}
              alt="文章封面"
            />
          )}
          <div
            className="prose"
            dangerouslySetInnerHTML={{ __html: data.html }}
          />
        </article>
      )}
    </>
  );
}
