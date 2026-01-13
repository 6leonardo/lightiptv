

export type ConfigResponse = {
  locale: string;
};


export interface ChannelFrontend {
    id: string;
    tvgId: string;
    chno: string | null;
    name: string;
    stream: string;
    logo: string | null;
    group: string;
    epgKey: string;
    isStreaming: boolean;
}

export interface ProgramFrontend {
    id: string;
    start: Date;
    end: Date;
    title?: string;
    desc?: string;
    category?: string;
    preview: string | null;
}



export type EpgResponse = {
  programs: Record<string, ProgramFrontend[]>; // key is channel epgKey
};


export type ChannelsResponse = {
  channels: Record<string, ChannelFrontend>; // key is channel id
};

export const API_BASE = import.meta.env.VITE_API_BASE || '';

export async function fetchEpgGrid(): Promise<EpgResponse> {
  const response = await fetch(`${API_BASE}/api/epg`);  
  if (!response.ok) {
    throw new Error(`EPG request failed (${response.status})`);
  }
  return response.json();
}

export async function fetchChannels(): Promise<ChannelsResponse> {
  const response = await fetch(`${API_BASE}/api/channels`);
  if (!response.ok) {
    throw new Error(`Channels request failed (${response.status})`);
  }
  return response.json();
}

export async function fetchTabs(): Promise<{ tabs: Record<string, string[]> }> {
  const response = await fetch(`${API_BASE}/api/tabs`);
  if (!response.ok) {
    throw new Error(`Tabs request failed (${response.status})`);
  }
  return response.json();
}


export async function fetchConfig(): Promise<ConfigResponse> {
  const response = await fetch(`${API_BASE}/api/config`);
  if (!response.ok) {
    throw new Error(`Config request failed (${response.status})`);
  }
  return response.json();
}

export async function startStreamAPI(streamUrl: string, channelName: string) {
  const response = await fetch(`${API_BASE}/api/stream/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamUrl, channelName })
  });
  const data = await response.json();
  return { status: response.status, data };
}
