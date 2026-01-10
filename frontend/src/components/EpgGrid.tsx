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
  ProgramImage,
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
const HOUR_WIDTH = 260; // 4.33px al minuto
const DAY_WIDTH = 24 * HOUR_WIDTH;
const SIDEBAR_WIDTH = 240;
const ITEM_HEIGHT = 80;

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
      programs.map((program, index) => {
        const since = new Date(program.start).toISOString();
        const till = new Date(program.end || program.start).toISOString();
        return {
          id: `${program.channelId}-${since}-${till}-${index}`,
          channelUuid: program.channelId,
          title: program.title || 'Senza titolo',
          since,
          till,
          image: program.preview || '',
          desc: program.desc,
          category: program.category,
          preview: program.preview,
          channelId: program.channelId
        };
      }),
    [programs]
  );

  const [startDate, endDate] = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1); // 24h esatte
    
    return [today.toISOString(), tomorrow.toISOString()];
  }, []);

  const { getEpgProps, getLayoutProps, onScrollToNow } = useEpg({
    channels: epgChannels,
    epg: epgPrograms,
    startDate,
    endDate,
    dayWidth: DAY_WIDTH,
    sidebarWidth: SIDEBAR_WIDTH,
    itemHeight: ITEM_HEIGHT,
    isTimeline: true,
    isLine: true,
    isBaseTimeFormat: false,
    theme: {
        primary: { 900: '#171923' },
        grey: { 300: '#d1d1d1' },
        white: '#fff',
        green: { 300: '#2C7A7B' },
        loader: { teal: '#5DDADB', purple: '#3437A2', pink: '#F78EB6', bg: '#171923db' },
        scrollbar: { border: '#ffffff', thumb: { bg: '#e1e1e1' } },
        gradient: { blue: { 300: '#002eb3', 600: '#002360', 900: '#051937' } },
        text: { grey: { 300: '#a0aec0', 500: '#718096' } },
        timeline: { divider: { bg: '#718096' } },
    }
  });

  const ProgramItem = ({ program, onStart, ...rest }: any) => {
    const { styles, formatTime, isLive, isMinWidth } = useProgram({ program, ...rest });
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
            {isLive && isMinWidth && data.image && <ProgramImage src={data.image} alt="Preview" />}
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
    const { time, dividers, formatTime } = useTimeline(
      props.numberOfHoursInDay,
      props.isBaseTimeFormat
    );

    const renderDividers = () =>
      dividers.map((_, index) => (
        <TimelineDivider key={index} width={props.hourWidth} />
      ));

    const renderTime = (index: number) => (
      <TimelineBox key={index} width={props.hourWidth}>
        <TimelineTime>
          {formatTime(index + props.offsetStartHoursRange).toLowerCase()}
        </TimelineTime>
        <TimelineDividers>{renderDividers()}</TimelineDividers>
      </TimelineBox>
    );

    return (
      <TimelineWrapper
        dayWidth={props.dayWidth}
        sidebarWidth={props.sidebarWidth}
        isSidebar={props.isSidebar}
      >
        {time.map((_, index) => renderTime(index))}
      </TimelineWrapper>
    );
  };

  return (
    <div className="epg-grid" style={{ height: '80vh', width: '100%' }}>
      <Epg {...getEpgProps()}>
        <Layout
          {...getLayoutProps()}
          renderTimeline={(props) => (
             <Timeline 
                 {...props} 
                 // Force props if missing
                 dayWidth={DAY_WIDTH} 
                 sidebarWidth={SIDEBAR_WIDTH}
                 isSidebar={true}
                 // Calculate hourWidth if missing (Planby should provide it but let's be safe)
                 hourWidth={HOUR_WIDTH}
             />
          )}
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
    </div>
  );
}
