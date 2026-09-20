export const preferenceKey = "kuaiwen.preferences.v1";
export const historyKey = "kuaiwen.history.v1";
export const defaults = { autoSend: true, delay: 3, saveHistory: true };
export function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
    return {
      autoSend: typeof value.autoSend === "boolean" ? value.autoSend : true,
      delay: [1, 3, 5, 10].includes(value.delay) ? value.delay : 3,
      saveHistory: typeof value.saveHistory === "boolean" ? value.saveHistory : true
    };
  } catch {
    return defaults;
  }
}
export function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(historyKey) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (item) =>
              typeof item.id === "string" &&
              typeof item.content === "string" &&
              typeof item.answer === "string"
          )
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}
export function writeHistory(items) {
  // Bound both record count and total storage to avoid exhausting localStorage.
  const result = items.slice(0, 30);
  while (JSON.stringify(result).length > 1_500_000 && result.length) result.pop();
  localStorage.setItem(historyKey, JSON.stringify(result));
  return result;
}
