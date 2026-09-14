export function createFrameMessage({ roomId, revision, contentVersion, serverNow, type, payload = {} }) {
  return { source: 'bel-presentation-demo-online', roomId, revision, contentVersion, serverNow, type, payload };
}

export function acceptFrameMessage(event, { roomId, origin = window.location.origin, source = window } = {}) {
  if (event.origin !== origin || event.source !== source || event.data?.source !== 'bel-presentation-demo-online' || event.data.roomId !== roomId) return null;
  return event.data;
}
