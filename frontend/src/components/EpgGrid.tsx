import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Epg, Layout, useEpg, useProgram } from 'planby';
import type { ChannelDto, ProgramDto } from '../api';

const HOUR_MS = 60 * 60 * 1000;

type EpgGridProps = {
  channels: ChannelDto[];
  programs: ProgramDto[];
  hoursAhead?: number;
  onStartChannel?: (channelId: string) => void;
};

type PlanbyChannel = {
  uuid: string;
  name: string;
  logo: string | null;
};

type PlanbyProgram = {
  id: string;
  channelUuid: string;
  title: string;
  since: string;
  till: string;
  image: string | null;
  desc: string | null;
  category: string | null;
  preview: string | null;
  channelId: string;
};

const formatTime = (date: Date) => {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

export default function EpgGrid({ channels, programs, hoursAhead = 6, onStartChannel }: EpgGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 600 });

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  const epgChannels = useMemo<PlanbyChannel[]>(
    () =>
      channels.map((channel) => ({
        uuid: channel.id,
        name: channel.name,
        logo: channel.logo
      })),
    [channels]
  );

  const epgPrograms = useMemo<PlanbyProgram[]>(
    () =>
      programs.map((program, index) => ({
        id: `${program.channelId}-${program.start}-${program.end || 'na'}-${index}`,
        channelUuid: program.channelId,
        title: program.title,
        since: program.start,
        till: program.end,
        image: program.preview,
        desc: program.desc,
        category: program.category,
        preview: program.preview,
        channelId: program.channelId
      })),
    [programs]
  );

  const [startDate, endDate] = useMemo(() => {
    if (!programs.length) {
      const now = new Date();
      const base = new Date(now);
      base.setMinutes(0, 0, 0);
      const end = new Date(base);
      end.setHours(base.getHours() + Math.max(1, hoursAhead));
      return [base, end];
    }

    const startTimes = programs.map((program) => new Date(program.start).getTime());
    const minStart = new Date(Math.min(...startTimes));
    const base = new Date(minStart);
    base.setHours(0, 0, 0, 0);
    const end = new Date(base);
    end.setHours(23, 0, 0, 0);
    return [base, end];
  }, [programs, hoursAhead]);

  const { getEpgProps, getLayoutProps } = useEpg({
    channels: epgChannels,
    epg: epgPrograms,
    startDate,
    endDate,
    width: size.width,
    height: size.height,
    itemHeight: 74,
    sidebarWidth: 240,
    dayWidth: 24 * 300,
    isRTL: false
  });

  const ProgramItem = ({ program, onStart, ...rest }: any) => {
    const { styles, formatTime, isLive } = useProgram({ program, ...rest });
    const { data } = program;

    return (
      <div
        className={`epg-program-cell ${isLive ? 'is-active' : ''}`}
        style={{ ...styles.position, width: styles.width }}
        role="button"
        tabIndex={0}
        onClick={() => onStart?.(data.channelUuid)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onStart?.(data.channelUuid);
        }}
      >
        {(data.preview || data.image) && (
          <img
            className="epg-program-image"
            src={data.preview || data.image}
            alt={data.title}
            loading="lazy"
          />
        )}
        <div className="epg-program-time">
          {formatTime(data.since)} - {formatTime(data.till)}
        </div>
        <div className="epg-program-title">{data.title || 'Senza titolo'}</div>
        {data.category && <div className="epg-program-category">{data.category}</div>}
      </div>
    );
  };

  return (
    <div className="epg-grid" ref={containerRef}>
      {size.width > 0 && (
        <Epg {...getEpgProps()}>
          <Layout
            {...getLayoutProps()}
            renderChannel={({ channel }) => (
              <div
                className="epg-channel-cell"
                style={channel.position}
                key={channel.uuid}
                onClick={() => onStartChannel?.(channel.uuid)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onStartChannel?.(channel.uuid);
                }}
              >
                {channel.logo ? (
                  <img src={channel.logo} alt={channel.name} className="epg-channel-logo" />
                ) : (
                  <div className="epg-channel-logo placeholder">{channel.name.charAt(0)}</div>
                )}
                <div className="epg-channel-name">{channel.name}</div>
              </div>
            )}
            renderProgram={({ program, ...rest }) => {
              const key = `${program.data.channelUuid}-${program.data.since}-${program.data.till}-${program.data.title || ''}`;
              return (
                <ProgramItem
                  key={key}
                  program={program}
                  onStart={onStartChannel}
                  {...rest}
                />
              );
            }}
          />
        </Epg>
      )}
    </div>
  );
}
