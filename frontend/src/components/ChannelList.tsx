import React, { useMemo, useState } from 'react';
import type { ChannelStreamDto } from '../api';

type ChannelListProps = {
  channels: ChannelStreamDto[];
  onSelect: (channel: ChannelStreamDto) => void;
  activeId?: string | null;
};

export default function ChannelList({ channels, onSelect, activeId }: ChannelListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((channel) => channel.name.toLowerCase().includes(q));
  }, [channels, query]);

  return (
    <div className="channel-list-panel">
      <div className="channel-list-header">
        <div>
          <h2>Canali</h2>
          <span>{filtered.length} disponibili</span>
        </div>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cerca canale..."
        />
      </div>
      <div className="channel-list-body">
        {filtered.map((channel) => {
          const isActive = channel.tvgId === activeId;
          return (
            <button
              key={channel.tvgId}
              className={`channel-row ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(channel)}
              type="button"
            >
              {channel.logo ? (
                <img src={channel.logo} alt={channel.name} className="channel-row-logo" />
              ) : (
                <div className="channel-row-logo placeholder">{channel.name.charAt(0)}</div>
              )}
              <div className="channel-row-info">
                <div className="channel-row-name">{channel.name}</div>
                {channel.isStreaming && <span className="channel-row-live">LIVE</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
