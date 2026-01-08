export async function fetchChannels() {
    const response = await fetch('/api/channels');
    return await response.json();
}

export async function fetchEPG() {
    const response = await fetch('/api/epg');
    return await response.json();
}

export async function fetchPreviewsIndex() {
    const response = await fetch('/api/previews-index');
    if (response.ok) {
        return await response.json();
    }
    throw new Error('Previews index not available');
}

export async function startStreamAPI(streamUrl, channelName) {
    const response = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamUrl, channelName })
    });
    const data = await response.json();
    return { status: response.status, data };
}

export async function stopStreamAPI(sessionId) {
    return await fetch(`/api/stream/stop/${sessionId}`, {
        method: 'POST'
    });
}

export async function sendHeartbeat(sessionId) {
    return await fetch(`/api/stream/heartbeat/${sessionId}`, {
        method: 'POST'
    });
}

export async function getStreamStatus(sessionId) {
    const response = await fetch(`/api/stream/status/${sessionId}`);
    return await response.json();
}
