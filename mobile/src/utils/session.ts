export function createSessionId() {
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
