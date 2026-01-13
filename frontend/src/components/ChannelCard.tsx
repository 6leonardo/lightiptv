import type { ChannelFrontend } from "../api";
import { getBadgeColor, getChannelBadge } from "../utils/channelBadge";

function formatTime(date: Date) {
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
}

type ChannelCardProps = {
    channel: ChannelFrontend;
    program: any | null;
    onSelect: (channel: ChannelFrontend) => void;
};

export function ChannelCard({ channel, program, onSelect }: ChannelCardProps) {
    return (
        <button key={channel.tvgId} className="channel-card" onClick={() => onSelect(channel)} type="button">
            {channel.isStreaming && <span className="channel-live-dot" />}
            {channel.logo ? (
                <img src={channel.logo} alt={channel.name} className="channel-card-logo" />
            ) : (
                <div className="channel-card-logo placeholder" style={{ color: getBadgeColor(channel.name) }}>
                    {getChannelBadge(channel.name)}
                </div>
            )}
            <div className="channel-card-name">{channel.name}</div>
            {program && (
                <div className="channel-card-epg">
                    <span>
                        {formatTime(new Date(program.start))} - {formatTime(new Date(program.end))}
                    </span>
                    <strong>{program.title}</strong>
                </div>
            )}
        </button>
    );
}
