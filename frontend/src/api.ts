export type ChannelDto = {
  id: string;
  name: string;
  logo: string | null;
};

export type ProgramDto = {
  id: string;
  channelId: string;
  title: string;
  start: string;
  end: string;
  desc: string | null;
  category: string | null;
  preview: string | null;
};

export type EpgGridResponse = {
  channels: ChannelDto[];
  programs: ProgramDto[];
};

export type ConfigResponse = {
  locale: string;
};

export type ChannelStreamDto = {
  tvgId: string;
  name: string;
  stream: string;
  logo: string | null;
  group: string;
  isStreaming: boolean;
};

export type ChannelsResponse = {
  channels: ChannelStreamDto[];
};

export const API_BASE = import.meta.env.VITE_API_BASE || '';

export async function fetchEpgGrid(): Promise<EpgGridResponse> {
  const response = await fetch(`${API_BASE}/api/epg-grid`);
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
