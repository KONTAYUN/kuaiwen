import React, { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, Loader2, ArrowUpRight } from "lucide-react";

function nodeText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return node?.props ? nodeText(node.props.children) : "";
}
function CodeBlock({ children }) {
  const [state, setState] = useState("");
  const code = nodeText(children).replace(/\n$/, "");
  useEffect(() => setState(""), [code]);
  const language = children?.props?.className?.match(/language-([\w-]+)/)?.[1] || "代码";
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState("已复制");
    } catch {
      setState("复制失败，请选中复制");
    }
  }
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{language}</span>
        <button onClick={copy} aria-label="复制代码">
          {state === "已复制" ? <Check size={14} /> : <Copy size={14} />}
          {state || "复制代码"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
const components = {
  pre: CodeBlock,
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: ({ alt }) => <span className="muted">[图片：{alt || "未加载"}]</span>,
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  )
};
export const intentLabels = { auto: "自动识别", translate: "翻译", command: "解释命令", debug: "排查报错" };
export default function Answer({ result, busy, onRetry, onCopy, canRetry }) {
  const label =
    result?.status === "stopped"
      ? "已停止 · 内容可能不完整"
      : result?.status === "error"
        ? "未完成"
        : busy
          ? "正在生成"
          : "回答完成";
  return (
    <section className="answer-panel panel" aria-label="回答">
      <div className="panel-heading">
        <div className="section-title">
          <span className={`status-dot ${busy ? "working" : ""}`} />
          <h2>回答</h2>
        </div>
        <button
          className="icon-button"
          onClick={onCopy}
          disabled={!result?.answer}
          title="复制回答"
          aria-label="复制回答"
        >
          <Copy size={17} />
        </button>
      </div>
      {result ? (
        <>
          <div className="answer-meta">
            <span>{intentLabels[result.intent] || "自动识别"}</span>
            <span>{result.profileName}</span>
            <span role="status">{label}</span>
          </div>
          {result.error && (
            <div role="alert" className="notice error">
              {result.error}
            </div>
          )}
          {result.answer ? (
            <article className="markdown">
              <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
                {result.answer}
              </Markdown>
            </article>
          ) : busy ? (
            <div className="thinking">
              <Loader2 size={18} className="spin" />
              <span>正在整理内容…</span>
            </div>
          ) : null}
          {!busy && (
            <div className="answer-footer">
              <span>{result.answer.length.toLocaleString()} 字符</span>
              <button className="text-button" onClick={onRetry} disabled={!canRetry}>
                重新生成 <ArrowUpRight size={15} />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="answer-empty">
          <span className="empty-symbol">答</span>
          <span className="answer-empty-label">暂无回答</span>
        </div>
      )}
    </section>
  );
}
