import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import type { ChannelFrontend } from "../api";
import { startStreamAPI } from "../api";
import { getSocket } from "../socket";

const START_CHANNEL_NAME = "Rai 1";
const HEARTBEAT_INTERVAL = 5000;
const STATUS_POLL_INTERVAL = 1000;
const MAX_ATTEMPTS = 20;

type ZappingState = {
    channel: ChannelFrontend;
    status: "loading" | "ready" | "error";
    m3u8Url?: string;
    roomName: string;
};

type ZappingServiceState = {
    active: boolean;
    current: ZappingState | null;
    warming: ZappingState | null;
    healthyCount: number;
    totalChannels: number;
    errorCount: number;
    open: () => void;
    close: () => void;
};

export function useZappingService(channels: ChannelFrontend[], zapInterval = 10): ZappingServiceState {
    const [active, setActive] = useState(false);
    const [current, setCurrent] = useState<ZappingState | null>(null);
    const [warming, setWarming] = useState<ZappingState | null>(null);
    const errorChannelsRef = useRef<Set<string>>(new Set());
    const heartbeatRef = useRef<Map<string, number>>(new Map());
    const statusTimersRef = useRef<Set<number>>(new Set());
    const zapTimerRef = useRef<number | null>(null);
    const socketRef = useRef(getSocket());
    const currentRef = useRef<ZappingState | null>(null);
    const warmingRef = useRef<ZappingState | null>(null);
    const activeRef = useRef(active);

    useEffect(() => {
        currentRef.current = current;
    }, [current]);

    useEffect(() => {
        warmingRef.current = warming;
    }, [warming]);

    useEffect(() => {
        activeRef.current = active;
    }, [active]);

    const totalChannels = channels.length;

    const startHeartbeat = useCallback((roomName: string) => {
        if (heartbeatRef.current.has(roomName)) return;
        const timer = window.setInterval(() => {
            socketRef.current.emit("stream-heartbeat", roomName);
        }, HEARTBEAT_INTERVAL);
        heartbeatRef.current.set(roomName, timer);
    }, []);

    const stopHeartbeat = useCallback((roomName: string) => {
        const timer = heartbeatRef.current.get(roomName);
        if (timer) {
            window.clearInterval(timer);
            heartbeatRef.current.delete(roomName);
        }
    }, []);

    const stopAllHeartbeats = useCallback(() => {
        heartbeatRef.current.forEach((timer) => window.clearInterval(timer));
        heartbeatRef.current.clear();
    }, []);

    const stopChannel = useCallback((roomName?: string | null) => {
        if (!roomName) return;
        stopHeartbeat(roomName);
        socketRef.current.emit("leave-stream", roomName);
        socketRef.current.emit("stream-close", roomName);
    }, [stopHeartbeat]);

    const clearStatusTimers = useCallback(() => {
        statusTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        statusTimersRef.current.clear();
    }, []);

    const selectStartChannel = useCallback(() => {
        const byName = channels.find(
            (channel) => channel.name.toLowerCase() === START_CHANNEL_NAME.toLowerCase()
        );
        return byName || channels[0] || null;
    }, [channels]);

    const pickNextChannel = useCallback(
        (currentId?: string) => {
            const candidates = channels.filter(
                (channel) =>
                    channel.tvgId !== currentId &&
                    !errorChannelsRef.current.has(channel.tvgId)
            );
            if (!candidates.length) return null;
            return candidates[Math.floor(Math.random() * candidates.length)];
        },
        [channels]
    );

    const initStream = useCallback(async (channel: ChannelFrontend) => {
        const { status: responseStatus, data } = await startStreamAPI(channel.stream, channel.name);
        if (responseStatus === 429 || data.error) {
            errorChannelsRef.current.add(channel.tvgId);
            return null;
        }
        const roomName = channel.name;
        const fallbackUrl =
            data.m3u8Url ||
            (data.m3u8Path ? new URL(data.m3u8Path, window.location.origin).toString() : "");
        socketRef.current.emit("join-stream", roomName);
        startHeartbeat(roomName);
        return { roomName, fallbackUrl };
    }, [startHeartbeat]);

    const waitForReady = useCallback(
        (channel: ChannelFrontend, roomName: string, fallbackUrl: string): Promise<ZappingState> => {
            let attempts = 0;
            const socket = socketRef.current;
            const timers: number[] = [];

            return new Promise((resolve) => {
                const clearTimers = () => {
                    timers.forEach((timer) => {
                        window.clearTimeout(timer);
                        statusTimersRef.current.delete(timer);
                    });
                    timers.length = 0;
                };

                const onStatus = (result: any) => {
                    if (result.channelName && result.channelName !== roomName) return;
                    if (result.ready) {
                        socket.off("stream-status", onStatus);
                        clearTimers();
                        resolve({
                            channel,
                            roomName,
                            status: "ready",
                            m3u8Url: result.m3u8Url || fallbackUrl,
                        });
                    }
                };

                socket.on("stream-status", onStatus);

                const tick = () => {
                    attempts += 1;
                    if (attempts >= MAX_ATTEMPTS) {
                        socket.off("stream-status", onStatus);
                        clearTimers();
                        resolve({ channel, roomName, status: "error", m3u8Url: fallbackUrl });
                        return;
                    }
                    const timer = window.setTimeout(tick, STATUS_POLL_INTERVAL);
                    timers.push(timer);
                    statusTimersRef.current.add(timer);
                };

                const timer = window.setTimeout(tick, STATUS_POLL_INTERVAL);
                timers.push(timer);
                statusTimersRef.current.add(timer);
            });
        },
        []
    );

    const promoteChannel = useCallback(
        (nextState: ZappingState) => {
            const previous = currentRef.current;
            setCurrent(nextState);
            setWarming(null);
            if (previous?.roomName && previous.roomName !== nextState.roomName) {
                stopChannel(previous.roomName);
            }
        },
        [stopChannel]
    );

    const warmAndPromote = useCallback(
        async (channel: ChannelFrontend) => {
            if (warmingRef.current) return false;
            const init = await initStream(channel);
            if (!init) return false;
            setWarming({
                channel,
                roomName: init.roomName,
                status: "loading",
                m3u8Url: init.fallbackUrl,
            });
            const ready = await waitForReady(channel, init.roomName, init.fallbackUrl);
            if (!activeRef.current) {
                stopChannel(init.roomName);
                return false;
            }
            if (ready.status === "ready") {
                promoteChannel(ready);
                return true;
            }
            errorChannelsRef.current.add(channel.tvgId);
            stopChannel(init.roomName);
            setWarming(null);
            return false;
        },
        [initStream, promoteChannel, stopChannel, waitForReady]
    );

    const open = useCallback(() => {
        setActive(true);
    }, []);

    const close = useCallback(() => {
        setActive(false);
        setCurrent(null);
        setWarming(null);
        clearStatusTimers();
        stopAllHeartbeats();
        if (currentRef.current?.roomName) stopChannel(currentRef.current.roomName);
        if (warmingRef.current?.roomName) stopChannel(warmingRef.current.roomName);
    }, [clearStatusTimers, stopAllHeartbeats, stopChannel]);


    useEffect(() => {
        if (!active) return;
        if (!channels.length) return;
        if (current || warming) return;
        let cancelled = false;
        const run = async () => {
            let candidate: ChannelFrontend | null = selectStartChannel();
            if (candidate && errorChannelsRef.current.has(candidate.tvgId)) {
                candidate = pickNextChannel(candidate.tvgId);
            }
            while (candidate && !cancelled) {
                const success = await warmAndPromote(candidate);
                if (success || cancelled || !activeRef.current) return;
                candidate = pickNextChannel(candidate.tvgId);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [active, channels.length, current, warming, pickNextChannel, selectStartChannel, warmAndPromote]);

    useEffect(() => {
        if (!active || !current?.channel) return;
        if (zapTimerRef.current) window.clearTimeout(zapTimerRef.current);
        zapTimerRef.current = window.setTimeout(async () => {
            if (!activeRef.current) return;
            if (warmingRef.current) return;
            const currentState = currentRef.current;
            const next = pickNextChannel(currentState?.channel.tvgId);
            if (!next) return;
            await warmAndPromote(next);
        }, zapInterval * 1000);

        return () => {
            if (zapTimerRef.current) window.clearTimeout(zapTimerRef.current);
        };
    }, [active, current?.channel, /*warming,*/ pickNextChannel, warmAndPromote, zapInterval]);

    useEffect(() => {
        const socket = socketRef.current;
        const handleKilled = (payload: { channelName?: string }) => {
            if (!payload.channelName) return;
            const warmingState = warmingRef.current;
            const currentState = currentRef.current;

            if (warmingState?.roomName === payload.channelName) {
                errorChannelsRef.current.add(warmingState.channel.tvgId);
                stopChannel(warmingState.roomName);
                setWarming(null);
                return;
            }

            if (currentState?.roomName === payload.channelName) {
                errorChannelsRef.current.add(currentState.channel.tvgId);
                stopChannel(currentState.roomName);
                setCurrent(null);
                setWarming(null);
                return;
            }
        };
        socket.on("stream-killed", handleKilled);
        return () => {
            socket.off("stream-killed", handleKilled);
        };
    }, [stopChannel]);

    useEffect(() => {
        return () => {
            if (zapTimerRef.current) window.clearTimeout(zapTimerRef.current);
            clearStatusTimers();
            stopAllHeartbeats();
            if (currentRef.current?.roomName) stopChannel(currentRef.current.roomName);
            if (warmingRef.current?.roomName) stopChannel(warmingRef.current.roomName);
        };
    }, [clearStatusTimers, stopAllHeartbeats, stopChannel]);

    const healthyCount = useMemo(() => {
        return totalChannels - errorChannelsRef.current.size;
    }, [totalChannels]);

    const errorCount = useMemo(() => errorChannelsRef.current.size, [totalChannels]);

    return {
        active,
        current,
        warming,
        healthyCount,
        totalChannels,
        errorCount,
        open,
        close,
    };
}

export function useZappingPlayer(m3u8Url?: string) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);

    useEffect(() => {
        if (!m3u8Url || !videoRef.current) return;
        const video = videoRef.current;
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                manifestLoadingTimeOut: 5000,
                levelLoadingTimeOut: 5000,
                fragLoadingTimeOut: 20000,
            });
            hlsRef.current = hls;
            hls.loadSource(m3u8Url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play().catch(() => undefined);
            });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = m3u8Url;
            video.addEventListener("loadedmetadata", () => {
                video.play().catch(() => undefined);
            });
        }

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [m3u8Url]);

    return { videoRef };
}
