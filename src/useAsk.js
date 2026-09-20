import { useEffect, useRef, useState } from "react";
import { checkResponse } from "./api";
import { readSse } from "../shared/stream";

export function useAsk({ onRecord }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(null);
  const lastSent = useRef("");
  const onRecordRef = useRef(onRecord);
  onRecordRef.current = onRecord;
  function stop({ discard = false } = {}) {
    const current = active.current;
    active.current = null; // Invalidate before abort: late chunks may already be queued.
    current?.controller.abort();
    if (current && !discard) {
      const partial = { ...current.record, status: "stopped" };
      setResult(partial);
      if (partial.answer) onRecordRef.current(partial);
    }
    setBusy(false);
  }
  function clear() {
    stop({ discard: true });
    lastSent.current = "";
    setResult(null);
  }
  function restore(record) {
    clear();
    setResult(record);
  }
  async function ask({ content, profile, intent }, { force = false } = {}) {
    content = content.trim();
    if (!profile || !content || content.length > 50000) return;
    const signature = JSON.stringify([content, profile.id, intent]);
    if (!force && lastSent.current === signature) return;
    stop();
    lastSent.current = signature;
    const current = {
      controller: new AbortController(),
      record: {
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString(),
        content,
        answer: "",
        profileId: profile.id,
        profileName: profile.name,
        model: profile.model,
        intent,
        status: "streaming"
      }
    };
    active.current = current;
    setBusy(true);
    setResult({ ...current.record });
    try {
      const response = await checkResponse(
        await fetch("/api/ask", {
          method: "POST",
          signal: current.controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: profile.id, content, intent })
        })
      );
      let completed = false;
      for await (const data of readSse(response.body)) {
        if (active.current !== current) return;
        const event = JSON.parse(data);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "delta") {
          current.record.answer += event.text;
          setResult({ ...current.record });
        }
        if (event.type === "done") {
          completed = true;
          break;
        }
      }
      if (active.current !== current) return;
      if (!completed) throw new Error("连接中断，回答可能不完整，请重试。");
      current.record.status = "complete";
      setResult({ ...current.record });
      onRecordRef.current({ ...current.record });
    } catch (error) {
      if (active.current !== current) return;
      lastSent.current = "";
      current.record.status = "error";
      current.record.error =
        error.message === "Failed to fetch" ? "网络连接失败，请检查网络后重试。" : error.message;
      setResult({ ...current.record });
      if (current.record.answer) onRecordRef.current({ ...current.record });
    } finally {
      if (active.current === current) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(
    () => () => {
      active.current?.controller.abort();
      active.current = null;
    },
    []
  );
  return { result, busy, ask, stop, clear, restore };
}
