export function etaForServerTime({ etaOrigin, serverNow, clientNow = Date.now() }) {
  if (!Number.isFinite(etaOrigin) || !Number.isFinite(serverNow)) return null;
  return Math.max(0, etaOrigin - serverNow + clientNow);
}
