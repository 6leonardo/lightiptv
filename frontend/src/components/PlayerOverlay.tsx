import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import type { ChannelStreamDto, ProgramDto } from "../api";
import { getSocket } from "../socket";
import { startStreamAPI } from "../api";

const MAX_ATTEMPTS = 60;
const STATUS_POLL_INTERVAL = 1000;
const HEARTBEAT_INTERVAL = 5000;

function formatTime(date: Date) {
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
}

type PlayerOverlayProps = {
    channel: ChannelStreamDto | null;
    programs: ProgramDto[];
    onClose: () => void;
};

type PlayerStatus =
    | { state: "idle" }
    | { state: "loading"; progress: number; tsCount: number; elapsed: number }
    | { state: "ready" }
    | { state: "error"; message: string }
    | { state: "limit"; maxStreams: number; activeStreams: number };

export default function PlayerOverlay({ channel, programs, onClose }: PlayerOverlayProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const heartbeatRef = useRef<number | null>(null);
    const cancelledRef = useRef(false);
    const pollTimeoutRef = useRef<number | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const startRequestedRef = useRef(false);
    const [status, setStatus] = useState<PlayerStatus>({ state: "idle" });
    const [showSidebar, setShowSidebar] = useState(false);
    const [showLog, setShowLog] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const socketRef = useRef(getSocket());
    const roomNameRef = useRef<string | null>(null);
    const joinedRef = useRef(false);
    const [logLines, setLogLines] = useState<string[]>([]);
    const [bufferInfo, setBufferInfo] = useState<{ ahead: number; behind: number; buffered: number; currentSegment: number; totalSegments: number } | null>(null);

    const channelPrograms = useMemo(() => {
        if (!channel) return { current: null, next: [] as ProgramDto[] };
        const now = new Date();
        const list = programs
            .filter((program) => program.channelId === channel.tvgId)
            .map((program) => ({ ...program, startDate: new Date(program.start), endDate: new Date(program.end) }))
            .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

        const current = list.find((program) => now >= program.startDate && now <= program.endDate) || null;
        const next = list.filter((program) => program.startDate > now).slice(0, 5);

        return { current, next };
    }, [channel, programs]);

    const channelLogo = channel?.logo || null;

    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "h" || event.key === "H") {
                setShowLog((prev) => !prev);
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, []);

    useEffect(() => {
        const socket = socketRef.current;
        const handleLog = (lines: string[]) => {
            setLogLines((prev) => {
                const combined = [...prev, ...lines.map((line) => line.trim())].filter(Boolean);
                return combined.slice(-50);
            });
        };
        socket.on("ffmpeg-log", handleLog);
        return () => {
            socket.off("ffmpeg-log", handleLog);
        };
    }, []);

    useEffect(() => {
        const socket = socketRef.current;
        const handleKilled = (payload: { channelName?: string; why?: string }) => {
            if (!roomNameRef.current || payload.channelName !== roomNameRef.current) return;
            setStatus({ state: "error", message: payload.why || "Stream chiuso" });
            cleanupPlayer();
            onClose();
        };
        socket.on("stream-killed", handleKilled);
        return () => {
            socket.off("stream-killed", handleKilled);
        };
    }, [onClose]);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, []);

    useEffect(() => {
        const handlePageExit = () => {
            if (!roomNameRef.current || !joinedRef.current) return;
            socketRef.current.emit("stream-close", roomNameRef.current);
            socketRef.current.emit("leave-stream", roomNameRef.current);
            joinedRef.current = false;
        };

        window.addEventListener("beforeunload", handlePageExit);
        window.addEventListener("pagehide", handlePageExit);
        return () => {
            window.removeEventListener("beforeunload", handlePageExit);
            window.removeEventListener("pagehide", handlePageExit);
        };
    }, []);

    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            if (e.key === 'd' || e.key === 'D') {
                setShowDebug((prev) => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyPress);
        return () => {
            window.removeEventListener('keydown', handleKeyPress);
        };
    }, []);

    useEffect(() => {
        if (!channel) return;

        // Previeni doppia esecuzione se già in corso
        if (startRequestedRef.current) return;
        
        let cancelled = false;
        cancelledRef.current = false;
        startRequestedRef.current = true;
        setStatus({ state: "loading", progress: 0, tsCount: 0, elapsed: 0 });
        setLogLines([]);

        const startStream = async () => {
            try {
                const { status: responseStatus, data } = await startStreamAPI(channel.stream, channel.name);
                if (cancelled) return; // Check se nel frattempo è stato cancellato
                
                if (responseStatus === 429) {
                    setStatus({ state: "limit", maxStreams: data.maxStreams, activeStreams: data.activeStreams });
                    return;
                }
                if (data.error) {
                    throw new Error(data.error);
                }

                roomNameRef.current = channel.name;
                socketRef.current.emit("join-stream", channel.name);
                joinedRef.current = true;
                startHeartbeat();

                const streamUrl =
                    data.m3u8Url ||
                    (data.m3u8Path ? new URL(data.m3u8Path, window.location.origin).toString() : "");
                await waitForStreamReady(streamUrl);
            } catch (err) {
                if (!cancelled) {
                    setStatus({ state: "error", message: err instanceof Error ? err.message : "Errore avvio stream" });
                }
            }
        };

        startStream();

        return () => {
            cancelled = true;
            cancelledRef.current = true;
            startRequestedRef.current = false;
            cleanupPlayer();
        };
    }, [channel]);

    const waitForStreamReady = async (fallbackUrl: string) => {
        let attempts = 0;
        const socket = socketRef.current;

        const onStatus = (result: any) => {
            if (cancelledRef.current) return;
            const tsCount = result.tsCount || 0;
            setStatus({
                state: "loading",
                progress: result.progress || 0,
                tsCount,
                elapsed: result.elapsedTime || 0,
            });

            if (result.ready) {
                const readyUrl =
                    result.m3u8Url ||
                    fallbackUrl ||
                    (result.m3u8Path
                        ? new URL(result.m3u8Path, window.location.origin).toString()
                        : "");
                setStatus({ state: "ready" });
                initializePlayer(readyUrl);
                socket.off("stream-status", onStatus);
                if (pollTimeoutRef.current) {
                    window.clearTimeout(pollTimeoutRef.current);
                    pollTimeoutRef.current = null;
                }
            }
            if (result.error) {
                socket.off("stream-status", onStatus);
                if (pollTimeoutRef.current) {
                    window.clearTimeout(pollTimeoutRef.current);
                    pollTimeoutRef.current = null;
                }
                setStatus({ state: "error", message: result.error || "Errore stream" });
                cleanupPlayer();
                onClose();
            }
        };

        socket.on("stream-status", onStatus);

        const tick = () => {
            if (cancelledRef.current) return;
            attempts += 1;
            if (attempts >= MAX_ATTEMPTS) {
                socket.off("stream-status", onStatus);
                setStatus({ state: "error", message: "Timeout: stream non pronto" });
                return;
            }
            pollTimeoutRef.current = window.setTimeout(tick, STATUS_POLL_INTERVAL);
        };

        pollTimeoutRef.current = window.setTimeout(tick, STATUS_POLL_INTERVAL);
    };

    const startHeartbeat = () => {
        if (!roomNameRef.current) return;
        if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = window.setInterval(() => {
            socketRef.current.emit("stream-heartbeat", roomNameRef.current);
        }, HEARTBEAT_INTERVAL);
    };

    const initializePlayer = (m3u8Url: string) => {
        const video = videoRef.current;
        const wrapper = wrapperRef.current;
        if (!video || !wrapper) return;

        const resizeVideo = () => {
            if (!video.videoWidth || !video.videoHeight) return;
            const videoRatio = video.videoWidth / video.videoHeight;
            const containerWidth = wrapper.clientWidth;
            const containerHeight = wrapper.clientHeight;
            if (!containerWidth || !containerHeight) return;

            const containerRatio = containerWidth / containerHeight;
            let newWidth: number;
            let newHeight: number;

            if (videoRatio > containerRatio) {
                newWidth = containerWidth;
                newHeight = containerWidth / videoRatio;
            } else {
                newHeight = containerHeight;
                newWidth = containerHeight * videoRatio;
            }

            video.style.width = `${newWidth}px`;
            video.style.height = `${newHeight}px`;
            video.style.maxWidth = "none";
            video.style.maxHeight = "none";
        };

        video.addEventListener("loadedmetadata", resizeVideo);
        video.addEventListener("resize", resizeVideo);

        const observer = new ResizeObserver(() => {
            window.requestAnimationFrame(resizeVideo);
        });
        observer.observe(wrapper);
        resizeObserverRef.current = observer;

        if (Hls.isSupported()) {
            const SEGMENTS_BACK = 3; // Start 3 segments back from live edge
            
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                maxBufferLength: 30,
                backBufferLength: 10,
                manifestLoadingTimeOut: 5000,
                levelLoadingTimeOut: 5000,
                fragLoadingTimeOut: 20000,
            });
            hlsRef.current = hls;
            hls.loadSource(m3u8Url);
            hls.attachMedia(video);
            
            // Monitor buffer position
            const bufferMonitor = setInterval(() => {
                if (!hls.media) return;
                
                const currentTime = hls.media.currentTime;
                const buffered = hls.media.buffered;
                
                // Calculate buffered ahead
                let bufferAhead = 0;
                for (let i = 0; i < buffered.length; i++) {
                    if (buffered.start(i) <= currentTime && buffered.end(i) > currentTime) {
                        bufferAhead = buffered.end(i) - currentTime;
                        break;
                    }
                }
                
                // Calculate distance from live edge and current segment
                const levels = hls.levels;
                const currentLevel = hls.currentLevel;
                let liveEdge = 0;
                let currentSegment = 0;
                let totalSegments = 0;
                
                if (levels && levels[currentLevel]?.details) {
                    const details = levels[currentLevel].details;
                    if (details && details.edge !== undefined) {
                        liveEdge = details.edge - currentTime;
                    }
                    
                    // Find current segment
                    totalSegments = details.fragments.length;
                    for (let i = 0; i < details.fragments.length; i++) {
                        const frag = details.fragments[i];
                        if (frag.start <= currentTime && frag.start + frag.duration > currentTime) {
                            currentSegment = i + 1; // 1-based for display
                            break;
                        }
                    }
                }
                
                setBufferInfo({
                    ahead: bufferAhead,
                    behind: liveEdge,
                    buffered: bufferAhead,
                    currentSegment,
                    totalSegments
                });
            }, 1000);
            
            hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
                if (data.levels.length > 0) {
                    const targetDuration = data.levels[0].details?.targetduration;
                    
                    if (targetDuration) {
                        // Calculate seconds to go back from live edge
                        const secondsBack = SEGMENTS_BACK * targetDuration;
                        
                        console.log(`[HLS] Starting ${SEGMENTS_BACK} segments (~${secondsBack}s) back from live edge`);
                    }
                }
                video.play().catch(() => undefined);
            });
            
            hls.on(Hls.Events.ERROR, (_event, data) => {
                console.log('[HLS] Error:', data.type, data.details, data.fatal);
                
                if (!data.fatal) return;
                
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('[HLS] Fatal network error, restarting...');
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('[HLS] Fatal media error, recovering...');
                        hls.recoverMediaError();
                        break;
                    default:
                        console.log('[HLS] Unrecoverable error, destroying player');
                        clearInterval(bufferMonitor);
                        hls.destroy();
                }
            });
            
            // Cleanup buffer monitor
            const originalDestroy = hls.destroy.bind(hls);
            hls.destroy = () => {
                clearInterval(bufferMonitor);
                originalDestroy();
            };
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = m3u8Url;
            video.addEventListener("loadedmetadata", () => {
                video.play().catch(() => undefined);
            });
        }
    };

    const cleanupPlayer = () => {
        if (pollTimeoutRef.current) {
            window.clearTimeout(pollTimeoutRef.current);
            pollTimeoutRef.current = null;
        }
        if (heartbeatRef.current) {
            window.clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
        }
        if (roomNameRef.current && joinedRef.current) {
            socketRef.current.emit("stream-close", roomNameRef.current);
            socketRef.current.emit("leave-stream", roomNameRef.current);
            roomNameRef.current = null;
            joinedRef.current = false;
        }
        if (hlsRef.current) {
            hlsRef.current.stopLoad();
            hlsRef.current.detachMedia();
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (resizeObserverRef.current) {
            resizeObserverRef.current.disconnect();
            resizeObserverRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.removeAttribute("src");
            videoRef.current.load();
        }
    };

    const handleClose = () => {
        cleanupPlayer();
        onClose();
    };

    if (!channel) return null;

    return (
        <div className="player-overlay">
            <div className="player-container">
                <button className="player-close" onClick={handleClose} type="button">
                    ×
                </button>
                <div className="player-video" ref={wrapperRef}>
                    <video
                        ref={videoRef}
                        controls
                        autoPlay
                        style={{ visibility: status.state === "ready" ? "visible" : "hidden" }}
                    />
                    {status.state === "loading" && (
                        <div className="player-loading">
                            <div className="player-loading-text">Preparazione stream...</div>
                            <div className="player-progress">
                                <div className="player-progress-bar" style={{ width: `${status.progress}%` }} />
                            </div>
                            <div className="player-progress-meta">
                                {status.tsCount} segments · {status.elapsed}s
                            </div>
                        </div>
                    )}
                    {status.state === "ready" && bufferInfo && showDebug && (
                        <div className="player-buffer-info">
                            <div className="buffer-stat">
                                <span className="buffer-label">Segment:</span>
                                <span className="buffer-value">{bufferInfo.currentSegment}/{bufferInfo.totalSegments}</span>
                            </div>
                            <div className="buffer-stat">
                                <span className="buffer-label">Buffer:</span>
                                <span className="buffer-value">{bufferInfo.buffered.toFixed(1)}s</span>
                            </div>
                            {bufferInfo.behind > 0 && (
                                <div className="buffer-stat">
                                    <span className="buffer-label">Latency:</span>
                                    <span className="buffer-value">{bufferInfo.behind.toFixed(1)}s</span>
                                </div>
                            )}
                        </div>
                    )}
                    {status.state === "error" && (
                        <div className="player-error">
                            <h3>Errore</h3>
                            <p>{status.message}</p>
                        </div>
                    )}
                    {status.state === "limit" && (
                        <div className="player-error">
                            <h3>Limite raggiunto</h3>
                            <p>
                                Max stream: {status.maxStreams} · Attivi: {status.activeStreams}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {showSidebar && (
                <aside className="player-epg">
                    <div className="player-epg-header">
                        <h4>Programma</h4>
                        <span>Adesso e prossimi</span>
                    </div>
                    <div className="player-epg-body">
                        {channelPrograms.current ? (
                            <div className="player-epg-current">
                                <div className="player-epg-label">NOW PLAYING</div>
                                {channelPrograms.current.preview &&
                                    (!channelLogo || channelPrograms.current.preview !== channelLogo) && (
                                    <img
                                        className="player-epg-preview"
                                        src={channelPrograms.current.preview}
                                        alt={channelPrograms.current.title || "Program"}
                                    />
                                )}
                                <div className="player-epg-title">{channelPrograms.current.title}</div>
                                <div className="player-epg-time">
                                    {formatTime(new Date(channelPrograms.current.start))} -{" "}
                                    {formatTime(new Date(channelPrograms.current.end))}
                                </div>
                                {channelPrograms.current.desc && <p>{channelPrograms.current.desc}</p>}
                            </div>
                        ) : (
                            <div className="player-epg-empty">Nessun programma in onda</div>
                        )}

                        {channelPrograms.next.length > 0 && (
                            <div className="player-epg-next">
                                <div className="player-epg-label">UP NEXT</div>
                                {channelPrograms.next.map((program, index) => (
                                    <div
                                        key={`${program.channelId}-${program.start}-${program.end}-${index}`}
                                        className="player-epg-card"
                                    >
                                        {program.preview && (!channelLogo || program.preview !== channelLogo) && (
                                            <img
                                                className="player-epg-preview"
                                                src={program.preview}
                                                alt={program.title || "Program"}
                                            />
                                        )}
                                        <div className="player-epg-title">{program.title}</div>
                                        <div className="player-epg-time">
                                            {formatTime(new Date(program.start))} - {formatTime(new Date(program.end))}
                                        </div>
                                        {program.category && <span>{program.category}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </aside>
            )}

            <div className={`player-log ${showLog ? "open" : "closed"}`}>
                <div className="player-log-body">
                    <pre>{logLines.join("\n")}</pre>
                </div>
            </div>
            <button
                type="button"
                className={`player-log-tab-btn ${showLog ? "open" : ""}`}
                onClick={() => setShowLog((prev) => !prev)}
            >
                LOG
            </button>

            <button
                type="button"
                className={`player-epg-tab ${showSidebar ? "open" : ""}`}
                onClick={() => setShowSidebar((prev) => !prev)}
            >
                EPG
            </button>
        </div>
    );
}
