import React, { useMemo } from "react";
import type { ChannelFrontend, ProgramFrontend } from "../api";
import { getBadgeColor, getChannelBadge } from "../utils/channelBadge";

function formatTime(date: Date) {
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
}

type ChannelGridProps = {
    channels: ChannelFrontend[];
    programs: Record<string, ProgramFrontend[]>;
    onSelect: (channel: ChannelFrontend) => void;
};

export default function ChannelGrid({ channels, programs, onSelect }: ChannelGridProps) {
    const now = new Date();

    const programMap = useMemo(() => {
        const map = new Map<string, ProgramFrontend>();
        for (const key in programs) {
            for (const program of programs[key]) {
                const start = new Date(program.start);
                const end = new Date(program.end);
                if (now >= start && now <= end) {
                    map.set(key, program);
                    break;
                }
            }
        }
        return map;
    }, [programs, now]);
    
    return (
        <div className="channel-grid">
            {channels.map((channel) => {
                const current = programMap.get(channel.epgKey);
                return (
                    <button
                        key={channel.tvgId}
                        className="channel-card"
                        onClick={() => onSelect(channel)}
                        type="button"
                    >
                        {channel.isStreaming && <span className="channel-live-dot" />}
                        {channel.logo ? (
                            <img src={channel.logo} alt={channel.name} className="channel-card-logo" />
                        ) : (
                            <div
                                className="channel-card-logo placeholder"
                                style={{ color: getBadgeColor(channel.name) }}
                            >
                                {getChannelBadge(channel.name)}
                            </div>
                        )}
                        <div className="channel-card-name">{channel.name}</div>
                        {current && (
                            <div className="channel-card-epg">
                                <span>
                                    {formatTime(new Date(current.start))} - {formatTime(new Date(current.end))}
                                </span>
                                <strong>{current.title}</strong>
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
