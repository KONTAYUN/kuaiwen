// Preserve UTF-8 characters and SSE frames split across chunks.
export async function* readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (!line) {
          if (data.length) yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (buffer.length + data.reduce((sum, line) => sum + line.length, 0) > 1_000_000)
        throw new Error("响应片段过大，请换一个模型重试。");
      if (done) break;
    }
    // An incomplete event without a blank-line terminator is discarded.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
