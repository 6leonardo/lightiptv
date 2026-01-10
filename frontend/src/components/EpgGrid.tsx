import { useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import type { CSSProperties } from 'react';
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

const HOUR_WIDTH = 260; // 4.33px al minuto
const DAY_WIDTH = 24 * HOUR_WIDTH;
const SIDEBAR_WIDTH = 100;
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

type ProgramRenderProps = {
  program: {
    data: PlanbyProgram;
  };
};

type TimelineProps = {
  dayWidth: number;
  sidebarWidth: number;
  isSidebar: boolean;
  hourWidth: number;
  numberOfHoursInDay: number;
  offsetStartHoursRange: number;
  isBaseTimeFormat: boolean;
};

type ChannelRenderProps = {
  channel: {
    uuid: string;
    name: string;
    logo: string | null;
    position: CSSProperties;
  };
};

export default function EpgGrid({ channels, programs, hoursAhead = 6, onStartChannel }: EpgGridProps) {
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
    () => {
      const now = new Date();
      // Filtra solo programmi nell'intervallo: adesso - 2h fino a adesso + hoursAhead
      const rangeStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const rangeEnd = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

      return programs
        .filter((program) => {
          const start = new Date(program.start);
          const end = new Date(program.end || program.start);
          // Verifica sovrapposizione temporale
          return start < rangeEnd && end > rangeStart;
        })
        .map((program, index) => {
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
        });
    },
    [programs, hoursAhead]
  );

  const [startDate, endDate] = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(end.getHours() + Math.max(1, hoursAhead));

    return [today.toISOString(), end.toISOString()];
  }, [hoursAhead]);

  const { getEpgProps, getLayoutProps } = useEpg({
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

  const ProgramItem = ({
    program,
    onStart
  }: ProgramRenderProps & { onStart?: (channelId: string) => void }) => {
    const { styles, formatTime, isLive } = useProgram({ program });
    const { data } = program;

    return (
      <ProgramBox
        width={styles.width}
        style={styles.position}
        role="button"
        tabIndex={0}
        onClick={() => onStart?.(data.channelUuid)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'Enter') onStart?.(data.channelUuid);
        }}
      >
        <ProgramContent width={styles.width} isLive={isLive} style={{ padding: '0px' }}>
          <ProgramFlex>
            {data.image && (
              <ProgramImage
                src={data.image}
                alt={data.title}
                className="epg-program-image"
              />
            )}
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

  const Timeline = (props: TimelineProps) => {
    const { numberOfHoursInDay, isBaseTimeFormat } = props;
    const { time, dividers, formatTime } = useTimeline(numberOfHoursInDay, isBaseTimeFormat);

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
    <div className="epg-grid" style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      <Epg {...getEpgProps()}>
        <Layout
          {...getLayoutProps()}
          renderTimeline={(props: TimelineProps) => (
            <Timeline
              {...props}
              dayWidth={props.dayWidth || DAY_WIDTH}
              sidebarWidth={props.sidebarWidth ?? SIDEBAR_WIDTH}
              isSidebar={props.isSidebar ?? true}
              hourWidth={props.hourWidth || HOUR_WIDTH}
            />
          )}
          renderChannel={({ channel }: ChannelRenderProps) => (
            <ChannelBox
              {...channel.position}
              key={channel.uuid}
                onClick={() => onStartChannel?.(channel.uuid)}
                role="button"
                tabIndex={0}
                onKeyDown={(event: KeyboardEvent) => {
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
            renderProgram={({ program }: ProgramRenderProps) => {
              const key = `${program.data.channelUuid}-${program.data.since}-${program.data.till}-${program.data.title || ''}`;
              return (
                <ProgramItem
                  key={key}
                  program={program}
                  onStart={onStartChannel}
                />
              );
            }}
          />
        </Epg>
    </div>
  );
}
