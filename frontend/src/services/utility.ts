import { ChannelFrontend, ProgramFrontend } from "../api";

export interface NowPlaying {
    channels: Map<string, ChannelFrontend>
    programs: Map<string, ProgramFrontend>
}

function getNowPlaying(channels: ChannelFrontend[], programs: Record<string, ProgramFrontend[]>): NowPlaying {
    const nowplaying = {
        channels: new Map<string, ChannelFrontend>(),
        programs: new Map<string, ProgramFrontend>()
    };
    const now = new Date();
    for (const channel of channels) {
        if (channel.epgKey in programs) {
            const channelPrograms = programs[channel.epgKey];
            const currentPrograms = channelPrograms.filter(program => {
                const start = new Date(program.start);
                const end = new Date(program.end);
                return now >= start && now <= end;
            });
            if (currentPrograms.length > 0) {
                nowplaying.channels.set(channel.id, channel);
                nowplaying.programs.set(channel.id, currentPrograms[0]);
            }
        }
    }
    return nowplaying;
}

function getFilteredChannels(channels: Record<string, ChannelFrontend>, filter: string, programs: Record<string, ProgramFrontend[]> = {}, onlyEpg: boolean = false): ChannelFrontend[] {
    const isGroupFilter = filter.trim().toLocaleLowerCase().startsWith('g:');
    if (isGroupFilter) {
        const regex = new RegExp(filter.trim().slice(2).trim(), 'i');
        return Object.values(channels).filter(channel => regex.test(channel.group) && (!onlyEpg || channel.epgKey in programs));
    } else {
        const regex = new RegExp(filter.trim(), 'i');
        return Object.values(channels).filter(channel => regex.test(channel.name) && (!onlyEpg || channel.epgKey in programs));
    }
}

function getEpgChannels(channels: ChannelFrontend[], programs: Record<string, ProgramFrontend[]>): ChannelFrontend[] {
    return channels.filter(channel => channel.epgKey in programs);
}

function getEpgPrograms(channels: ChannelFrontend[], programs: Record<string, ProgramFrontend[]>): Record<string, ProgramFrontend[]> {
    const epg: Record<string, ProgramFrontend[]> = {};
    for (const channel of channels) {
        if (programs[channel.epgKey]) {
            epg[channel.epgKey] = programs[channel.epgKey];
        }
    }
    return epg;
}



export { getNowPlaying, getFilteredChannels, getEpgChannels, getEpgPrograms };