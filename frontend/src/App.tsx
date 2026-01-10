import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ChannelGrid from './components/ChannelGrid';
import EpgGrid from './components/EpgGrid';
import PlayerOverlay from './components/PlayerOverlay';
import { fetchChannels, fetchEpgGrid } from './api';
import type { ChannelDto, ChannelStreamDto, ProgramDto } from './api';
import { useSocketUpdates } from './hooks/useSocketUpdates';

const EPG_HOURS_AHEAD = 24;

export default function App() {
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [streamChannels, setStreamChannels] = useState<ChannelStreamDto[]>([]);
  const [programs, setPrograms] = useState<ProgramDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelStreamDto | null>(null);
  const [view, setView] = useState<'channels' | 'now' | 'epg'>('channels');
  const [filterText, setFilterText] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [epg, channelData] = await Promise.all([fetchEpgGrid(), fetchChannels()]);
      setChannels(epg.channels);
      setPrograms(epg.programs);
      const normalizedChannels = channelData.channels.map((channel) => ({
        ...channel,
        logo: channel.logo === 'none' ? null : channel.logo
      }));
      setStreamChannels(normalizedChannels);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante il caricamento');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useSocketUpdates(loadData);

  const subtitle = useMemo(() => {
    if (!updatedAt) return 'In attesa di dati';
    return `Aggiornato alle ${updatedAt.toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  }, [updatedAt]);

  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredChannels = useMemo(() => {
    if (!normalizedFilter) return streamChannels;
    return streamChannels.filter((channel) => channel.name.toLowerCase().includes(normalizedFilter));
  }, [streamChannels, normalizedFilter]);

  const programsByChannel = useMemo(() => {
    const map = new Map<string, ProgramDto[]>();
    programs.forEach((program) => {
      const list = map.get(program.channelId) || [];
      list.push(program);
      map.set(program.channelId, list);
    });
    return map;
  }, [programs]);

  const epgChannels = useMemo(() => {
    return channels.filter((channel) => programsByChannel.has(channel.id));
  }, [channels, programsByChannel]);

  const epgPrograms = useMemo(() => {
    return programs.filter((program) => programsByChannel.has(program.channelId));
  }, [programs, programsByChannel]);

  const filteredEpgChannels = useMemo(() => {
    if (!normalizedFilter) return epgChannels;
    return epgChannels.filter((channel) => channel.name.toLowerCase().includes(normalizedFilter));
  }, [epgChannels, normalizedFilter]);

  const filteredEpgPrograms = useMemo(() => {
    const allowed = new Set(filteredEpgChannels.map((channel) => channel.id));
    return epgPrograms.filter((program) => allowed.has(program.channelId));
  }, [epgPrograms, filteredEpgChannels]);

  const nowPlaying = useMemo(() => {
    const now = new Date();
    const channelMap = new Map(channels.map((channel) => [channel.id, channel.name]));
    return programs
      .filter((program) => {
        if (!program.preview) return false;
        const start = new Date(program.start);
        const end = new Date(program.end);
        return start <= now && end >= now;
      })
      .map((program) => ({
        ...program,
        channelName: channelMap.get(program.channelId) || program.channelId
      }))
      .filter((program) => {
        if (!normalizedFilter) return true;
        const text = `${program.title || ''} ${program.channelName}`.toLowerCase();
        return text.includes(normalizedFilter);
      });
  }, [channels, normalizedFilter, programs]);

  const handleStartChannel = useCallback(
    (channelId: string) => {
      const match = streamChannels.find((channel) => channel.tvgId === channelId);
      if (match) setActiveChannel(match);
    },
    [streamChannels]
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>IPTV EPG</h1>
          <p>{subtitle}</p>
        </div>
        <div className="app-badge">Prossime {EPG_HOURS_AHEAD}h</div>
      </header>

      {error && <div className="app-error">{error}</div>}

      <div className="app-tabs">
        <div className="app-tabs-buttons">
          <button
            type="button"
            className={view === 'channels' ? 'active' : ''}
            onClick={() => setView('channels')}
          >
            Canali
          </button>
          <button
            type="button"
            className={view === 'now' ? 'active' : ''}
            onClick={() => setView('now')}
          >
            Now Playing
          </button>
          <button
            type="button"
            className={view === 'epg' ? 'active' : ''}
            onClick={() => setView('epg')}
          >
            EPG
          </button>
        </div>
        <input
          type="text"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder="Cerca canale..."
        />
      </div>

      {loading ? (
        <div className="app-loading">Caricamento EPG...</div>
      ) : view === 'channels' ? (
        <main className="app-main app-main-full">
          <div className="app-epg-panel">
            <ChannelGrid channels={filteredChannels} programs={programs} onSelect={setActiveChannel} />
          </div>
        </main>
      ) : view === 'now' ? (
        <main className="app-main app-main-full">
          <div className="app-epg-panel">
            <div className="now-playing-header">Now Playing</div>
            <div className="now-playing-grid">
              {nowPlaying.map((program) => (
                <button
                  key={`${program.channelId}-${program.start}-${program.end}`}
                  className="now-playing-card"
                  onClick={() => handleStartChannel(program.channelId)}
                  type="button"
                >
                  {program.preview && (
                    <img src={program.preview} alt={program.title || 'Program'} />
                  )}
                  <div className="now-playing-body">
                    <div className="now-playing-channel">{program.channelName}</div>
                    <div className="now-playing-title">{program.title || 'Senza titolo'}</div>
                    <div className="now-playing-time">
                      {new Date(program.start).toLocaleTimeString('it-IT', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}{' '}
                      -{' '}
                      {new Date(program.end).toLocaleTimeString('it-IT', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                </button>
              ))}
              {nowPlaying.length === 0 && (
                <div className="now-playing-empty">Nessun programma in onda con preview</div>
              )}
            </div>
          </div>
        </main>
      ) : (
        <main className="app-main app-main-full">
          <div className="app-epg-panel">
            <EpgGrid
              channels={filteredEpgChannels}
              programs={filteredEpgPrograms}
              hoursAhead={EPG_HOURS_AHEAD}
              onStartChannel={handleStartChannel}
            />
          </div>
        </main>
      )}

      {activeChannel && (
        <PlayerOverlay
          channel={activeChannel}
          programs={programs}
          onClose={() => setActiveChannel(null)}
        />
      )}
    </div>
  );
}
