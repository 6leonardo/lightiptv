import React, { useMemo } from 'react';
import type { ChannelDto, ProgramDto } from '../api';
import { getBadgeColor, getChannelBadge } from '../utils/channelBadge';

const HOUR_MS = 60 * 60 * 1000;

type EpgTimelineProps = {
  channels: ChannelDto[];
  programs: ProgramDto[];
  hoursAhead?: number;
  onStartChannel?: (channelId: string) => void;
};

function formatTime(date: Date) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export default function EpgTimeline({
  channels,
  programs,
  hoursAhead = 6,
  onStartChannel
}: EpgTimelineProps) {
  const now = useMemo(() => new Date(), []);
  const windowEnd = useMemo(() => new Date(now.getTime() + hoursAhead * HOUR_MS), [now, hoursAhead]);
  const timelineHours = useMemo(() => {
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    return Array.from({ length: hoursAhead }, (_, index) => {
      const next = new Date(start);
      next.setHours(start.getHours() + index);
      return next;
    });
  }, [now, hoursAhead]);

  const programsByChannel = useMemo(() => {
    const map = new Map<string, ProgramDto[]>();
    programs.forEach((program) => {
      const list = map.get(program.channelId) || [];
      list.push(program);
      map.set(program.channelId, list);
    });
    map.forEach((list, key) => {
      list.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      map.set(key, list);
    });
    return map;
  }, [programs]);

  const channelLogoMap = useMemo(() => {
    const map = new Map<string, string | null>();
    channels.forEach((channel) => {
      map.set(channel.id, channel.logo);
    });
    return map;
  }, [channels]);

  const rows = useMemo(() => {
    return channels
      .map((channel) => {
        const list = programsByChannel.get(channel.id) || [];
        const filtered = list.filter((program) => {
          const start = new Date(program.start);
          const end = new Date(program.end);
          return end >= now && start <= windowEnd;
        });
        return { channel, programs: filtered };
      })
      .filter((row) => row.programs.length > 0);
  }, [channels, programsByChannel, now, windowEnd]);

  return (
    <div className="epg-timeline">
      <div className="epg-timeline-scroll">
        <div className="epg-timeline-grid">
          <div className="epg-timeline-header">
            <div className="epg-timeline-spacer" />
            <div className="epg-timeline-hours">
              {timelineHours.map((hour) => (
                <div key={hour.toISOString()} className="epg-timeline-hour">
                  {formatTime(hour)}
                </div>
              ))}
            </div>
          </div>
          {rows.map(({ channel, programs: channelPrograms }) => (
            <div key={channel.id} className="epg-row">
              <div
                className="epg-row-channel"
                role="button"
                tabIndex={0}
                onClick={() => onStartChannel?.(channel.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onStartChannel?.(channel.id);
                }}
              >
                {channel.logo ? (
                  <img src={channel.logo} alt={channel.name} className="epg-row-logo" />
                ) : (
                  <>
                    <div
                      className="epg-row-logo placeholder"
                      style={{ color: getBadgeColor(channel.name) }}
                    >
                      {getChannelBadge(channel.name)}
                    </div>
                    <div className="epg-row-name">{channel.name}</div>
                  </>
                )}
              </div>
              <div className="epg-row-programs">
            {channelPrograms.map((program, index) => {
              const start = new Date(program.start);
              const end = new Date(program.end);
              const isLive = now >= start && now <= end;
              const channelLogo = channelLogoMap.get(program.channelId) || null;
              const showPreview = Boolean(
                program.preview && (!channelLogo || program.preview !== channelLogo)
              );
              return (
                <div
                  key={`${program.channelId}-${program.start}-${program.end}-${index}`}
                  className={`epg-card ${isLive ? 'live' : ''}`}
                >
                  {showPreview && (
                    <img src={program.preview} alt={program.title || 'Program'} />
                  )}
                      <div className="epg-card-time">
                        {formatTime(start)} - {formatTime(end)}
                      </div>
                      <div className="epg-card-title">{program.title || 'Senza titolo'}</div>
                      {program.category && (
                        <div className="epg-card-category">{program.category}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
