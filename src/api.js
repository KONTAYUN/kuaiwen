export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export async function checkResponse(response) {
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event("session-expired"));
  throw new ApiError(payload.error || `请求失败（HTTP ${response.status}）`, response.status);
}
export async function requestJson(url, body, method = "POST", signal) {
  const response = await fetch(url, {
    method,
    signal,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  // A wrong login password should not discard the login form's state.
  if (url === "/api/login" && !response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(payload.error || "登录失败。", response.status);
  }
  await checkResponse(response);
  return response.json();
}
