import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
    useTimeline,
} from "planby";
import type { ChannelFrontend, ProgramFrontend } from "../api";
import { useFailedImages } from "../hooks/useFailedImages";
import { markImageFailed } from "../utils/imageStore";
import { getBadgeColor, getChannelBadge } from "../utils/channelBadge";
const HOUR_WIDTH = 260; // 4.33px al minuto
const DAY_WIDTH = 12 * HOUR_WIDTH; // 12 ore totali (-1h to +11h)
const SIDEBAR_WIDTH = 100;
const ITEM_HEIGHT = 80;

type EpgGridProps = {
    channels: ChannelFrontend[];
    programs: Record<string, ProgramFrontend[]>;
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

export default function EpgGrid({ channels, programs, onStartChannel }: EpgGridProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [_, setSize] = useState({ width: 0, height: 600 });
    const [nowTick, setNowTick] = useState(() => Date.now());
    const failedImages = useFailedImages();
    const channelMeta = useMemo(() => {
        const map = new Map<string, { name: string; logo: string | null }>();
        channels.forEach((channel) => {
            map.set(channel.id, { name: channel.name, logo: channel.logo });
        });
        return map;
    }, [channels]);

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

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNowTick(Date.now());
        }, 60000);
        return () => window.clearInterval(timer);
    }, []);

    const epgChannels = useMemo<PlanbyChannel[]>(
        () =>
            channels.map((channel) => ({
                uuid: channel.id,
                name: channel.name,
                logo: channel.logo,
            })),
        [channels]
    );

    const epgPrograms = useMemo<PlanbyProgram[]>(() => {
        const now = new Date(nowTick);
        // Filtra solo programmi nell'intervallo: adesso - 1h fino a adesso + 11h
        const rangeStart = new Date(now.getTime() - 1 * 60 * 60 * 1000);
        const rangeEnd = new Date(now.getTime() + 11 * 60 * 60 * 1000);
        const epg: any[] = [];
        for (const channel of channels) {
            const channelPrograms = programs[channel.epgKey]
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
                        id: `${channel.id}-${since}-${till}-${index}`,
                        channelUuid: channel.id,
                        title: program.title || "Senza titolo",
                        since,
                        till,
                        image: program.preview || "",
                        desc: program.desc,
                        category: program.category,
                        preview: program.preview,
                        channelId: channel.id,
                    };
                });
            epg.push(...channelPrograms);
        }
        return epg;
    }, [programs, channels, nowTick]);

    const [startDate, endDate] = useMemo(() => {
        const now = new Date(nowTick);
        const start = new Date(now.getTime() - 1 * 60 * 60 * 1000); // -1 ora da adesso
        const end = new Date(now.getTime() + 11 * 60 * 60 * 1000); // +11 ore da adesso

        return [start.toISOString(), end.toISOString()];
    }, []); /*[nowTick]); non sposto la barra temporale se non si esce e rientra si sposta solo il now*/
    const offsetStartHoursRange = useMemo(() => new Date(startDate).getHours(), [startDate]);

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
            primary: { 900: "#171923" },
            grey: { 300: "#d1d1d1" },
            white: "#fff",
            green: { 300: "#2C7A7B" },
            loader: { teal: "#5DDADB", purple: "#3437A2", pink: "#F78EB6", bg: "#171923db" },
            scrollbar: { border: "#ffffff", thumb: { bg: "#e1e1e1" } },
            gradient: { blue: { 300: "#002eb3", 600: "#002360", 900: "#051937" } },
            text: { grey: { 300: "#a0aec0", 500: "#718096" } },
            timeline: { divider: { bg: "#718096" } },
        },
    });

    const ProgramItem = ({ program, onStart, ...rest }: any) => {
        const { styles, formatTime, isLive, isMinWidth } = useProgram({ program, ...rest });
        const { data } = program;
        const channelInfo = channelMeta.get(data.channelUuid);
        const showImage = Boolean(data.image && data.image !== (channelInfo?.logo || ""));
        return (
            <ProgramBox
                width={styles.width}
                style={styles.position}
                role="button"
                tabIndex={0}
                onClick={() => onStart?.(data.channelUuid)}
                onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === "Enter") onStart?.(data.channelUuid);
                }}
            >
                <ProgramContent width={styles.width} isLive={isLive} style={{ padding: "8px" }}>
                    <ProgramFlex>
                        {isMinWidth && data.image && showImage && !failedImages.has(data.image) && (
                            <ProgramImage
                                src={data.image}
                                alt="Preview"
                                style={{ marginRight: "8px", objectFit: "cover" }}
                                onError={() => markImageFailed(data.image)}
                            />
                        )}
                        <ProgramStack>
                            <ProgramTitle>{data.title || "Senza titolo"}</ProgramTitle>
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
        const offset = props.offsetStartHoursRange ?? 0;
        const { time, dividers, formatTime } = useTimeline(
            props.numberOfHoursInDay,
            props.isBaseTimeFormat,
            offset
        );

        const renderDividers = () =>
            dividers.map((_: any, index: number) => <TimelineDivider key={index} width={props.hourWidth} />);

        const renderTime = (index: number) => (
            <TimelineBox key={index} width={props.hourWidth}>
                <TimelineTime>{formatTime(index + offset).toLowerCase()}</TimelineTime>
                <TimelineDividers>{renderDividers()}</TimelineDividers>
            </TimelineBox>
        );

        return (
            <TimelineWrapper dayWidth={props.dayWidth} sidebarWidth={props.sidebarWidth} isSidebar={props.isSidebar}>
                {time.map((_: any, index: number) => renderTime(index))}
            </TimelineWrapper>
        );
    };

    return (
        <div className="epg-grid" style={{ height: "100%", width: "100%", overflow: "hidden" }}>
            <Epg {...getEpgProps()}>
                <Layout
                    {...getLayoutProps()}
                    renderTimeline={(props: any) => (
                        <Timeline
                            {...props}
                            // Force props if missing
                            dayWidth={DAY_WIDTH}
                            sidebarWidth={SIDEBAR_WIDTH}                            
                            isSidebar={true}
                            // Calculate hourWidth if missing (Planby should provide it but let's be safe)
                            hourWidth={HOUR_WIDTH}
                            offsetStartHoursRange={offsetStartHoursRange}
                        />
                    )}
                    renderChannel={({ channel }: any) => (
                        <ChannelBox
                            {...channel.position}
                            key={channel.uuid}
                            onClick={() => onStartChannel?.(channel.uuid)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                                if (event.key === "Enter") onStartChannel?.(channel.uuid);
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
                    renderProgram={({ program, ...rest }: any) => {
                        const key = `${program.data.channelUuid}-${program.data.since}-${program.data.till}-${
                            program.data.title || ""
                        }`;
                        return <ProgramItem key={key} program={program} onStart={onStartChannel} {...rest} />;
                    }}
                />
            </Epg>
        </div>
    );
}
