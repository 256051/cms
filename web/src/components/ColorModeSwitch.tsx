"use client";
import { useEffect, useState } from "react";
import { Monitor, Sun } from "lucide-react";
import { colorModeCookie, parseColorMode, type ColorMode } from "@/lib/theme";

/** The root attribute survives client navigation; the preference cookie also covers SSR and new tabs. */
export default function ColorModeSwitch({ initialMode, readOnly = false }: { initialMode: ColorMode; readOnly?: boolean }) {
  const [mode, setMode] = useState(initialMode);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (readOnly) return;
    const sync = () => {
      const saved = document.cookie.split("; ").find(cookie => cookie.startsWith(`${colorModeCookie}=`))?.split("=")[1];
      const current = parseColorMode(saved);
      document.documentElement.dataset.colorMode = current;
      setMode(current);
    };
    sync();
    setReady(true);
    window.addEventListener("pageshow", sync);
    window.addEventListener("focus", sync);
    return () => { window.removeEventListener("pageshow", sync); window.removeEventListener("focus", sync); };
  }, [initialMode, readOnly]);
  const next: ColorMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const names = { light: "明亮模式", dark: "黑暗模式", system: "跟随系统" };
  const label = `显示模式：当前${names[mode]}，点击切换为${names[next]}`;
  return <button type="button" className="color-mode-switch secondary" data-mode={mode} title={label} aria-label={label} disabled={!ready} onClick={() => {
      document.documentElement.dataset.colorMode = next;
      document.cookie = `${colorModeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      setMode(next);
    }}>
    {mode === "dark" ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="currentColor" width={22} height={22} aria-hidden="true"><path d="M524.8 938.667h-4.267a439.893 439.893 0 0 1-313.173-134.4 446.293 446.293 0 0 1-11.093-597.334A432.213 432.213 0 0 1 366.933 90.027a42.667 42.667 0 0 1 45.227 9.386 42.667 42.667 0 0 1 10.24 42.667 358.4 358.4 0 0 0 82.773 375.893 361.387 361.387 0 0 0 376.747 82.774 42.667 42.667 0 0 1 54.187 55.04 433.493 433.493 0 0 1-99.84 154.88 438.613 438.613 0 0 1-311.467 128z" /></svg> : mode === "light" ? <Sun size={22} aria-hidden="true" /> : <Monitor size={22} aria-hidden="true" />}
  </button>;
}
