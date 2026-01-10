import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Epg,
  Layout,
  useEpg,
  useProgram,
  ChannelBox,
  ChannelLogo,
  ProgramBox,
  ProgramContent,
  ProgramFlex,
  ProgramStack,
  ProgramTitle,
  ProgramText,
  TimelineWrapper,
  TimelineBox,
  TimelineTime,
  TimelineDivider,
  TimelineDividers,
  useTimeline
} from 'planby';
import type { ChannelDto, ProgramDto } from '../api';
import { getBadgeColor, getChannelBadge } from '../utils/channelBadge';

const HOUR_MS = 60 * 60 * 1000;
const HOUR_WIDTH = 260;

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
        title: program.title || 'Senza titolo',
        since: program.start,
        till: program.end,
        image: program.preview || '',
        desc: program.desc,
        category: program.category,
        preview: program.preview,
        channelId: program.channelId
      })),
    [programs]
  );

  const [startDate, endDate, rangeHours] = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() - 2);
    const totalHours = Math.max(1, hoursAhead);
    const end = new Date(start);
    end.setHours(end.getHours() + totalHours);
    return [start.toISOString(), end.toISOString(), totalHours];
  }, [hoursAhead]);

  const { getEpgProps, getLayoutProps, onScrollToNow } = useEpg({
    channels: epgChannels,
    epg: epgPrograms,
    startDate,
    endDate,
    width: size.width,
    height: size.height,
    itemHeight: 88,
    sidebarWidth: 240,
    dayWidth: rangeHours * HOUR_WIDTH,
    isRTL: false
  });

  const ProgramItem = ({ program, onStart, ...rest }: any) => {
    const { styles, formatTime, isLive } = useProgram({ program, ...rest });
    const { data } = program;

    return (
      <ProgramBox
        width={styles.width}
        style={styles.position}
        role="button"
        tabIndex={0}
        onClick={() => onStart?.(data.channelUuid)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onStart?.(data.channelUuid);
        }}
      >
        <ProgramContent width={styles.width} isLive={isLive}>
          <ProgramFlex>
            <ProgramStack>
              <ProgramTitle>{data.title || 'Senza titolo'}</ProgramTitle>
              <ProgramText>
                {formatTime(data.since)} - {formatTime(data.till)}
              </ProgramText>
              {data.category && <ProgramText>{data.category}</ProgramText>}
            </ProgramStack>
          </ProgramFlex>
        </ProgramContent>
      </ProgramBox>
    );
  };

  const Timeline = (props: any) => {
    const { dayWidth, hourWidth, numberOfHoursInDay, offsetStartHoursRange, sidebarWidth, isSidebar } = props;
    const { time, dividers, formatTime } = useTimeline(numberOfHoursInDay, false);
    return (
      <TimelineWrapper dayWidth={dayWidth} sidebarWidth={sidebarWidth} isSidebar={isSidebar}>
        {time.map((_, index) => (
          <TimelineBox key={index} width={hourWidth}>
            <TimelineTime>{formatTime(index + offsetStartHoursRange).toLowerCase()}</TimelineTime>
            <TimelineDividers>
              {dividers.map((__, dividerIndex) => (
                <TimelineDivider key={dividerIndex} width={hourWidth} />
              ))}
            </TimelineDividers>
          </TimelineBox>
        ))}
      </TimelineWrapper>
    );
  };

  useEffect(() => {
    if (!size.width || !size.height) return;
    if (!epgPrograms.length) return;
    onScrollToNow?.();
  }, [onScrollToNow, size.height, size.width, epgPrograms.length]);

  return (
    <div className="epg-grid" ref={containerRef} style={{ height: '80vh', width: '100%' }}>
      {size.width > 0 && (
        <Epg {...getEpgProps()}>
          <Layout
            {...getLayoutProps()}
            renderTimeline={(props) => <Timeline {...props} />}
            renderChannel={({ channel }) => (
              <ChannelBox
                {...channel.position}
                key={channel.uuid}
                onClick={() => onStartChannel?.(channel.uuid)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onStartChannel?.(channel.uuid);
                }}
              >
                {channel.logo ? (
                  <ChannelLogo src={channel.logo} alt={channel.name} />
                ) : (
                  <div
                    className="epg-channel-logo placeholder"
                    style={{ color: getBadgeColor(channel.name) }}
                  >
                    {getChannelBadge(channel.name)}
                  </div>
                )}
              </ChannelBox>
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
