import { useEffect } from "react";
import type { ChannelStreamDto } from "../api";
import { useZappingPlayer } from "../services/zappingService";

interface ZappingPlayerProps {
    channel: ChannelStreamDto | null;
    m3u8Url?: string;
    healthyCount: number;
    totalChannels: number;
    onClose: () => void;
    onOpenPlayer: () => void;
    zIndex: number;
    showOverlay?: boolean;
}

export default function ZappingPlayer({
    channel,
    m3u8Url,
    healthyCount,
    totalChannels,
    onClose,
    onOpenPlayer,
    zIndex,
    showOverlay = true,
}: ZappingPlayerProps) {
    const { videoRef } = useZappingPlayer(m3u8Url);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.muted = true;
        }
    }, [videoRef]);

    return (
        <div className="zapping-mode" style={{ zIndex }}>
            {showOverlay && (
                <div className="zapping-overlay">
                    <div className="zapping-header">
                        <div className="zapping-info">
                            <span className="zapping-icon">📺</span>
                            <span>{channel?.name || "Zapping Mode"}</span>
                            <span className="zapping-counter">
                                {healthyCount}/{totalChannels}
                            </span>
                        </div>
                        <div className="zapping-actions">
                            {channel && (
                                <button type="button" className="zapping-open" onClick={onOpenPlayer}>
                                    Apri Player
                                </button>
                            )}
                            <button type="button" onClick={onClose} className="zapping-close">
                                ✕
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="zapping-video">
                <video ref={videoRef} controls={showOverlay} autoPlay />
            </div>
        </div>
    );
}
