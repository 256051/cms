"use client";
import { useEffect, useRef, useState } from "react";

const message = "有尚未保存的修改，确定放弃吗？";

/** Confirm before an action such as logout invalidates the current editing session. */
export function confirmNavigation() {
  return window.dispatchEvent(
    new Event("cms:confirm-leave", { cancelable: true }),
  );
}

export function discardChanges() {
  window.dispatchEvent(new Event("cms:discard-changes"));
}

/** Admin links use native navigation, so history traversal also runs beforeunload. */
export function useUnsavedChanges() {
  const current = useRef(false);
  const [dirty, update] = useState(false);
  const setDirty = (value: boolean) => {
    current.current = value;
    update(value);
  };
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (current.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const confirm = (event: Event) => {
      if (current.current && !window.confirm(message)) event.preventDefault();
    };
    const discard = () => setDirty(false);
    if (dirty) window.addEventListener("beforeunload", leave);
    window.addEventListener("cms:confirm-leave", confirm);
    window.addEventListener("cms:discard-changes", discard);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("cms:confirm-leave", confirm);
      window.removeEventListener("cms:discard-changes", discard);
    };
  }, [dirty]);
  return {
    dirty,
    setDirty,
    markChanged: () => setDirty(true),
    markSaved: () => setDirty(false),
    confirmDiscard: () => !current.current || window.confirm(message),
  };
}
