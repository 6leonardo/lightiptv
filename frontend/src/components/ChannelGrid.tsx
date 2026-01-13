import React, { useMemo } from "react";
import type { ChannelFrontend, ProgramFrontend } from "../api";
import { ChannelCard } from "./ChannelCard";

type ChannelGridProps = {
    channels: ChannelFrontend[];
    tabs?: Record<string, string[]>;
    programs: Record<string, ProgramFrontend[]>;
    onSelect: (channel: ChannelFrontend) => void;
};

export default function ChannelGrid({ channels, tabs, programs, onSelect }: ChannelGridProps) {
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
        <>
            {tabs &&
                Object.keys(tabs).length > 0 &&
                Object.keys(tabs).map((tabName) => (
                    <div key={tabName} className="channel-grid-tab">
                        <h2 className="channel-grid-tab-title">{tabName}</h2>
                        <div className="channel-grid">
                            {tabs[tabName].map((channelName) => {
                                const channel = channels.find(
                                    (ch) => ch.name.toLocaleLowerCase() === channelName.toLocaleLowerCase()
                                );
                                if (!channel) return null;
                                return (
                                    <ChannelCard
                                        key={channel.id}
                                        channel={channel}
                                        program={programMap.get(channel.epgKey) || null}
                                        onSelect={onSelect}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
            {!(tabs && Object.keys(tabs).length > 0) &&
                channels.map((channel) => {
                    return (
                        <div className="channel-grid">
                            <ChannelCard
                                key={channel.tvgId}
                                channel={channel}
                                program={programMap.get(channel.epgKey) || null}
                                onSelect={onSelect}
                            />
                        </div>
                    );
                })}
        </>
    )}
