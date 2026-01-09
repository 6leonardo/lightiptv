interface ChannelEntry {
  id: string;
  name: string;
  logo: string;
  group: string;
  tvgId: string;
  stream: string;
}

/**
 * M3U Playlist Parser
 */
function parseM3U(content: string): ChannelEntry[] {
  const lines = content.split('\n');
  const channels: ChannelEntry[] = [];
  let currentChannel: ChannelEntry | null = null;

  const extractAttribute = (line: string, attr: string) => {
    const match = line.match(new RegExp(`${attr}="([^"]*)"`));
    return match ? match[1] : '';
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#EXTINF:')) {
      const nameMatch = trimmed.match(/,(.+)$/);
      currentChannel = {
        id: extractAttribute(trimmed, 'channelID'),
        name: extractAttribute(trimmed, 'tvg-name') || (nameMatch ? nameMatch[1] : ''),
        logo: extractAttribute(trimmed, 'tvg-logo'),
        group: extractAttribute(trimmed, 'group-title'),
        tvgId: extractAttribute(trimmed, 'tvg-id'),
        stream: ''
      };
    } else if (trimmed && !trimmed.startsWith('#') && currentChannel) {
      currentChannel.stream = trimmed;
      channels.push(currentChannel);
      currentChannel = null;
    }
  }

  return channels;
}

export { parseM3U, ChannelEntry };
