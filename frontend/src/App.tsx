import { useCallback, useEffect, useMemo, useState } from "react";
import ChannelGrid from "./components/ChannelGrid";
import EpgGrid from "./components/EpgGrid";
import PlayerOverlay from "./components/PlayerOverlay";
import ZappingPlayer from "./components/ZappingPlayer";
import { useZappingService } from "./services/zappingService";
import { fetchChannels, fetchConfig, fetchEpgGrid, fetchTabs } from "./api";
import { markImageFailed } from "./utils/imageStore";
import { useFailedImages } from "./hooks/useFailedImages";
import type { ChannelFrontend, ProgramFrontend } from "./api";
import { useSocketUpdates } from "./hooks/useSocketUpdates";
import { getNowPlaying, getEpgChannels, getEpgPrograms, getFilteredChannels } from "./services/utility";

const EPG_HOURS_AHEAD = 24;

type NowPlayingCardProps = {
    channel: ChannelFrontend;
    program: ProgramFrontend;
    locale: string;
    onSelect: (channelId: string) => void;
};

function NowPlayingCard({ channel, program, locale, onSelect }: NowPlayingCardProps) {
    const failedImages = useFailedImages();
    return (
        <button className="now-playing-card" onClick={() => onSelect(channel.id)} type="button">
            <div className="now-playing-media">
                {program.preview && !failedImages.has(program.preview) && (
                    <img
                        src={program.preview}
                        alt={program.title || "Program"}
                        onError={() => markImageFailed(program.preview || "")}
                    />
                )}
                {!(program.preview && !failedImages.has(program.preview)) && (
                    <div className="fallback">{program.title}</div>
                )}
            </div>
            <div className="now-playing-body">
                <div className="now-playing-channel">{channel.name}</div>
                <div className="now-playing-title">{program.title || "No Title"}</div>
                <div className="now-playing-time">
                    {new Date(program.start).toLocaleTimeString(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                    })}{" "}
                    -{" "}
                    {new Date(program.end).toLocaleTimeString(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                </div>
            </div>
        </button>
    );
}

export default function App() {
    const [channels, setChannels] = useState<Record<string, ChannelFrontend>>({});
    const [programs, setPrograms] = useState<Record<string, ProgramFrontend[]>>({});
    const [tabs, setTabs] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
    const [activeChannel, setActiveChannel] = useState<ChannelFrontend | null>(null);
    const [isZapping, setIsZapping] = useState(false);
    const [view, setView] = useState<"channels" | "now" | "epg">(() => {
        const saved = localStorage.getItem("iptv_view");
        return saved === "channels" || saved === "now" || saved === "epg" ? saved : "channels";
    });
    const [filterText, setFilterText] = useState("");
    const [locale, setLocale] = useState("it-IT");

    useEffect(() => {
        localStorage.setItem("iptv_view", view);
    }, [view]);

    const loadData = useCallback(async () => {
        try {
            const [epg, channelData, config, tabsData] = await Promise.all([fetchEpgGrid(), fetchChannels(), fetchConfig(), fetchTabs()]);
            setChannels(channelData.channels);
            setPrograms(epg.programs);
            setTabs(tabsData.tabs);
            setLocale(config.locale || "it-IT");
            setUpdatedAt(new Date());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error loading data");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useSocketUpdates(loadData);

    const subtitle = useMemo(() => {
        if (!updatedAt) return "Waiting for update...";
        return `Updated at ${updatedAt.toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
        })}`;
    }, [locale, updatedAt]);

    const filteredChannels = useMemo(() => getFilteredChannels(channels, filterText), [channels, filterText]);

    const zapping = useZappingService(filteredChannels, 30);

    const filteredEpgChannels = useMemo(() => getEpgChannels(filteredChannels, programs), [filteredChannels, programs]);

    const filteredEpgPrograms = useMemo(
        () => getEpgPrograms(filteredEpgChannels, programs),
        [filteredEpgChannels, programs]
    );

    const filteredNowPlaying = useMemo(() => getNowPlaying(filteredChannels, programs), [filteredChannels, programs]);

    const handleStartChannel = useCallback(
        (channelId: string) => {
            const match = channels[channelId];
            if (match) setActiveChannel(match);
        },
        [channels]
    );

    return (
        <div className="app-shell">
            <header className="app-header">
                <div>
                    <h1>IPTV EPG</h1>
                    <p>{subtitle}</p>
                </div>
                {/* <div className="app-badge">Prossime {EPG_HOURS_AHEAD}h</div> */}
                <div className="app-tabs">
                    <div className="app-tabs-buttons">
                        <button
                            type="button"
                            className={view === "channels" ? "active" : ""}
                            onClick={() => setView("channels")}
                        >
                            Canali
                        </button>
                        <button type="button" className={view === "now" ? "active" : ""} onClick={() => setView("now")}>
                            Now Playing
                        </button>
                        <button type="button" className={view === "epg" ? "active" : ""} onClick={() => setView("epg")}>
                            EPG
                        </button>
                        <button
                            type="button"
                            className="app-zapping-btn"
                            onClick={() => {
                                setIsZapping(true);
                                zapping.open();
                            }}
                        >
                            📺 Zapping
                        </button>
                    </div>
                    <input
                        type="text"
                        value={filterText}
                        onChange={(event) => setFilterText(event.target.value)}
                        placeholder="Search Channels..."
                    />
                </div>
            </header>

            {error && <div className="app-error">{error}</div>}

            {loading ? (
                <div className="app-loading">Caricamento EPG...</div>
            ) : view === "channels" ? (
                <main className="app-main app-main-full">
                    <div className="app-epg-panel" style={{ overflowY: "auto", overflowX: "hidden" }}>
                        <ChannelGrid channels={filteredChannels} tabs={tabs} programs={programs} onSelect={setActiveChannel} />
                    </div>
                </main>
            ) : view === "now" ? (
                <main className="app-main app-main-full">
                    <div className="app-epg-panel" style={{ overflowY: "auto" }}>
                        <div className="now-playing-header">Now Playing</div>
                        <div className="now-playing-grid">
                            {Array.from(filteredNowPlaying.channels.values()).map((channel) => {
                                const program = filteredNowPlaying.programs.get(channel.id);
                                if (!program || !program.preview) return null;
                                return (
                                    <NowPlayingCard
                                        key={`${channel.id}`}
                                        channel={channel}
                                        program={program}
                                        locale={locale}
                                        onSelect={handleStartChannel}
                                    />
                                );
                            })}
                            {filteredNowPlaying.channels.size === 0 && (
                                <div className="now-playing-empty">No programs currently playing with preview</div>
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
                    programs={programs[activeChannel.epgKey] || []}
                    onClose={() => setActiveChannel(null)}
                />
            )}

            {isZapping && zapping.active && (
                <>
                    {zapping.current && (
                        <ZappingPlayer
                            channel={zapping.current.channel}
                            m3u8Url={zapping.current.m3u8Url}
                            healthyCount={zapping.healthyCount}
                            totalChannels={zapping.totalChannels}
                            zIndex={15000}
                            onClose={() => {
                                setIsZapping(false);
                                zapping.close();
                            }}
                            onOpenPlayer={() => {
                                if (zapping.current?.channel) {
                                    setIsZapping(false);
                                    zapping.close();
                                    setActiveChannel(zapping.current.channel);
                                }
                            }}
                        />
                    )}
                    {zapping.warming && (
                        <ZappingPlayer
                            channel={zapping.warming.channel}
                            m3u8Url={zapping.warming.m3u8Url}
                            healthyCount={zapping.healthyCount}
                            totalChannels={zapping.totalChannels}
                            zIndex={10000}
                            showOverlay={false}
                            onClose={() => {
                                setIsZapping(false);
                                zapping.close();
                            }}
                            onOpenPlayer={() => {
                                if (zapping.current?.channel) {
                                    setIsZapping(false);
                                    zapping.close();
                                    setActiveChannel(zapping.current.channel);
                                }
                            }}
                        />
                    )}
                    {!zapping.current && (
                        <div className="zapping-loading">
                            <div className="zapping-loading-spinner" />
                            <div>Preparazione zapping...</div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
