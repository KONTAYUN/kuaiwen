import http from "node:http";

export async function listen(server, port = 0) {
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
export async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
export function createMockModel() {
  const requests = [];
  const aborted = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ url: req.url, body, authorization: req.headers.authorization });
    const prompt = body.messages?.at(-1)?.content || "";
    res.on("close", () => {
      if (!res.writableEnded) aborted.push(prompt);
    });
    if (req.url.endsWith("/models")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "mock-fast" }, { id: "mock-slow" }] }));
      return;
    }
    if (body.model === "unauthorized") {
      res.writeHead(401);
      res.end(JSON.stringify({ error: { message: "upstream secret-leak" } }));
      return;
    }
    if (body.model === "missing") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (prompt === "timeout") return;
    const answer = prompt.includes("markdown")
      ? "## 命令说明\n\n这条命令**只读取**当前目录。\n\n```bash\nls -la\n```\n\n| 操作 | 风险 |\n| --- | --- |\n| 读取 | 低 |\n\n<script>window.hacked = true</script>\n\n[不安全链接](javascript:alert(1))\n\n![外部图片](https://example.com/tracker.png)"
      : `这是「${prompt}」的回答。中文流式内容正常。`;
    if (!body.stream || body.model === "json-only") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.flushHeaders();
    const chunks = prompt === "slow" ? ["第一段", "第二段", "第三段"] : [answer.slice(0, 8), answer.slice(8)];
    let index = 0;
    function tick() {
      if (res.destroyed) return;
      if (index < chunks.length) {
        const frame = Buffer.from(
          `: heartbeat\r\ndata: ${JSON.stringify({ choices: [{ delta: { content: chunks[index++] } }] })}\r\n\r\n`
        );
        // Deliberately split the UTF-8 stream at arbitrary byte boundaries.
        for (let offset = 0; offset < frame.length; offset += 7)
          res.write(frame.subarray(offset, offset + 7));
        if (prompt === "truncated") {
          res.end();
          return;
        }
        if (prompt === "stream-timeout") return;
        timer = setTimeout(tick, prompt === "slow" ? 800 : 40);
      } else {
        res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      }
    }
    let timer = setTimeout(tick, prompt === "slow" ? 100 : 5);
    res.on("close", () => clearTimeout(timer));
  });
  return { server, requests, aborted };
}
