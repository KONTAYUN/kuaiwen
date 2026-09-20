import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export function publicConfig(config) {
  return {
    ...config,
    profiles: config.profiles.map(({ apiKey, ...profile }) => ({ ...profile, hasApiKey: Boolean(apiKey) }))
  };
}

export function createConfigStore(filename) {
  let queue = Promise.resolve();
  async function read() {
    try {
      const data = JSON.parse(await fs.readFile(filename, "utf8"));
      if (!Array.isArray(data.profiles)) throw new Error("Invalid profiles");
      return { profiles: data.profiles, activeProfileId: data.activeProfileId || data.profiles[0]?.id || "" };
    } catch (error) {
      if (error.code === "ENOENT") return { profiles: [], activeProfileId: "" };
      throw new Error("读取模型配置失败，请检查配置文件或从备份恢复。");
    }
  }
  function update(mutate) {
    const operation = queue.then(async () => {
      const config = await read();
      await mutate(config);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(config, null, 2), "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, filename);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      return publicConfig(config);
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { read, update };
}
