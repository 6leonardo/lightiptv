import { ChannelFrontend, ProgramFrontend } from "../api";

export interface NowPlaying {
    channels: Map<string, ChannelFrontend>
    programs: Map<string, ProgramFrontend>
}


function channelOrder(a: ChannelFrontend, b: ChannelFrontend): number {
    let aNo = parseInt(a.tvgNo || "10000");
    let bNo = parseInt(b.tvgNo || "10000");
    if (isNaN(aNo)) aNo = 10000;
    if (isNaN(bNo)) bNo = 10000;
    return aNo !== bNo ? aNo - bNo : a.name.localeCompare(b.name);
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
    try {
        const fex = /(?:^|\s)(?<type>[ngte]):(?<value>.*?)(?=\s+[ngte]:|$)/gi;
        const match = Array.from(filter.matchAll(fex));
        const exprs = match.length === 0 ? [{ type: 'n', value: filter }] : match.map(m => m.groups!);
        onlyEpg = onlyEpg || exprs.some(expr => expr.type.toLocaleLowerCase() === 'e');
        const rexs = exprs.map(expr =>
            (expr.type && expr.type.toLocaleLowerCase() !== 'e' && expr.value ? { type: expr.type.toLocaleLowerCase(), rex: new RegExp(expr.value.trim(), 'i') } : null)).filter(Boolean);
        console.log('getFilteredChannels:', { filter, exprs, rexs, onlyEpg });
        return Object.values(channels).filter(channel => (rexs.length === 0 || rexs.every(e =>
            e?.type == 'n' && e.rex.test(channel.name) ||
            e?.type == 'g' && e.rex.test(channel.group) ||
            e?.type == 't' && channel.extra.tab && e.rex.test(channel.extra.tab))) && (!onlyEpg ||( channel.epgKey in programs && programs[channel.epgKey].length > 0))).sort(channelOrder);
    }
    catch (error) {
        console.error('Error in getFilteredChannels:', (error as Error).message);
        if (onlyEpg) {
            return Object.values(channels).filter(channel => channel.epgKey in programs).sort(channelOrder);
        } else {
            return Object.values(channels).sort(channelOrder);
        }
    }
}

function getGroups(channels: ChannelFrontend[]): string[] {
    const groups = new Set<string>();
    for (const channel of channels)
        if (channel.group)
            channel.group.replace(/,:/g, ';').split(';').map(g => g.trim()).forEach(g => g && groups.add(g));

    return Array.from(groups).sort();
}

function getTabChannels(channels: ChannelFrontend[], tabChannels: string[]): ChannelFrontend[] {
    return tabChannels.map(name => channels.find((ch) => ch.name.toLocaleLowerCase() === name.toLocaleLowerCase())!).filter(Boolean);
}

function getEpgChannels(channels: ChannelFrontend[], programs: Record<string, ProgramFrontend[]>): ChannelFrontend[] {
    return channels.filter(channel => channel.epgKey in programs && programs[channel.epgKey].length > 0).sort(channelOrder);
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



export { getNowPlaying, getFilteredChannels, getEpgChannels, getEpgPrograms, getGroups, getTabChannels };