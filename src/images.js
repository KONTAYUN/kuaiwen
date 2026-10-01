import { imageTypes, MAX_IMAGE_BYTES } from "../shared/images";

export async function prepareImage(file) {
  if (!imageTypes.includes(file.type)) throw new Error("支持粘贴 PNG、JPEG、WebP 和 GIF 图片。");
  if (file.size > 20 * 1024 * 1024) throw new Error("原始图片不能超过 20 MB。");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    if (((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4 > MAX_IMAGE_BYTES)
      throw new Error("图片处理后仍超过 2 MB，请缩小图片后再粘贴。");
    return dataUrl;
  } catch (error) {
    throw new Error(error.message.includes("MB") ? error.message : "无法读取这张图片，请重新复制后粘贴。");
  } finally {
    URL.revokeObjectURL(url);
  }
}
