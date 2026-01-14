import axios from 'axios';
import type { AxiosResponse } from 'axios';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { Tab, getConfig, ConfigM3USource, ConfigXMLTVSource } from '../config/index.js';
import { parseM3U, ChannelEntry } from '../parsers/m3u.js';
import { parseXMLTV, ProgramEntry, normalizeString } from '../parsers/xmltv.js';
import { Server as SocketIOServer } from 'socket.io';

const config = getConfig();


interface ProgramRecord extends ProgramEntry {
    previewImagePath: string | null;
    previewImageFetched: 'no' | 'yes' | 'not-exists';
}

export interface ChannelRecord extends ChannelEntry {
    logoCachedPath: string | null;
    logoFetched: boolean;
    isActive?: boolean;
    epgKey?: string;
}

export interface ChannelFrontend {
    id: string;
    tvgNo: string;
    tvgId: string;
    name: string;
    stream: string;
    logo: string | null;
    group: string;
    epgKey: string;
    isStreaming: boolean;
}

export interface ProgramFrontend {
    id: string;
    start: Date;
    end: Date;
    title?: string;
    desc?: string;
    category?: string;
    preview: string | null;
}

interface Source {
    name: string;
    url: string;
    type: 'm3u' | 'xmltv';
    id: string;
}

interface DBSchema {
    channels: Record<string, ChannelRecord>; // key is channel id
    tabs: Record<string, string[]>; // key is tab name, values are channel ids
    decode: Record<string, string[]>; // key is channel name lowercased, values are channel ids
    programs: Record<string, ProgramRecord[]>; // key is domain
    sources: Record<string, Source>; // key is url
    ids: {
        source: number;
        channel: number;
        program: number;
    }

}


const DEFAULT_DB: DBSchema = {
    channels: {},
    decode: {},
    programs: {},
    sources: {},
    tabs: {},
    ids: {
        source: 0,
        channel: 0,
        program: 0
    }
};


class Database {
    db: DBSchema = DEFAULT_DB;
    cache: {
        epg: Record<string, ProgramFrontend[]>;
        channels: Record<string, ChannelFrontend>;
    } = {
            epg: {},
            channels: {}
        }

    init() {
        this.read();
    }

    read() {
        try {
            const data = JSON.parse(fs.readFileSync(config.paths.channels.db, 'utf-8'), (key, value) => {
                if (key === 'start' || key === 'stop') {
                    return new Date(value);
                }
                return value;
            });
            this.db = data;
        } catch (error) {
            console.error('Error reading channels database, initializing new one:', (error as Error).message);
            this.db = DEFAULT_DB;
            this.save();
        }

        return this.db;
    }

    save() {
        fs.writeFileSync(config.paths.channels.db, JSON.stringify(this.db, (key, value) => {
            if ((key === 'start' || key === 'stop') && value instanceof Date) {
                return (value as Date).toISOString();
            }
            return value;
        }, 2), 'utf-8');
    }
}


class ChannelService {
    database = new Database();
    socket: SocketIOServer | null = null;

    setSocket(ioInstance: SocketIOServer) {
        this.socket = ioInstance;
    }

    async init() {
        this.database.init();
        console.log('Channel database initialized found', Object.keys(this.database.db.channels).length, 'channels');
        await this.update();
    }

    private rankChannels(channel: ChannelRecord): void {
        const rankCriteria = [
            { test: ['4k', 'UHD'], properties: ['quality', 'resolution'], score: 5 },
            { test: ['FHD', '1080', 'HD'], properties: ['quality', 'resolution'], score: 3 },
            { test: ['SD', '720', '576'], properties: ['quality', 'resolution'], score: 2 },
            { test: ['480', '360'], properties: ['quality', 'resolution'], score: 1 },
            { test: ['true'], properties: ['geoBlocked'], score: -5 }
        ];
        let ranking = 0;
        const extra = channel.extra || {};
        for (const criterion of rankCriteria) {
            for (const prop of criterion.properties) {
                const value = ((channel as any)[prop] || extra[prop] || '').toString();
                if (value !== '') {
                    for (const testValue of criterion.test) {
                        const regex = new RegExp(`${testValue}`, 'i');
                        if (regex.test(value)) {
                            ranking += criterion.score;
                        }
                    }
                }
            }
        }
        channel.extra['ranking'] = ranking.toString();
    }

    getSource(source: ConfigM3USource | ConfigXMLTVSource, type: 'm3u' | 'xmltv', name: string): Source {
        const existingSource = Object.values(this.database.db.sources).find(src => src.url === source.url && src.type === type);
        if (existingSource) {
            return existingSource;
        }
        const newSource: Source = {
            name,
            url: source.url,
            type,
            id: `${this.database.db.ids.source++}`
        };
        this.database.db.sources[newSource.id] = newSource;
        this.database.save();
        return newSource;
    }

    getChannelByName(name: string): ChannelRecord[] {
        const channelIds = this.database.db.decode[name.toLowerCase()];
        if (channelIds) {
            return channelIds.map(id => this.database.db.channels[id]) || [];
        }
        return [];
    }

    get db() { return this.database.db; }
    get cache() { return this.database.cache; }

    private async updateSchedules() {
        const keys: string[] = []
        for (const sourceKey of Object.keys(config.xmltv.sources)) {
            const config_source = config.xmltv.sources[sourceKey];
            const responseXML = await axios.get(config_source.url);
            const { epgData, channels } = await parseXMLTV(responseXML.data);
            const schedules = this.db.programs;
            for (const channelRecord of Object.values(this.db.channels)) {
                let key: string = normalizeString(channelRecord.domain);
                if (key in epgData) {

                } else if (normalizeString(channelRecord.channelID) in epgData) {
                    key = normalizeString(channelRecord.channelID);
                } else if (normalizeString(channelRecord.tvgid) in epgData) {
                    key = normalizeString(channelRecord.tvgid);
                } else {
                    continue;
                }
                keys.push(key);
                channelRecord.epgKey = key;
            }
            for (const key of keys) {
                const allPrograms = epgData[key] || [];
                const schedule = schedules[key] || [];

                if (allPrograms.length > 0) {
                    const programs = allPrograms.filter(prog =>
                        schedule.findIndex(existingProg =>
                            existingProg.start.getTime() === new Date(prog.start).getTime() &&
                            existingProg.stop.getTime() === new Date(prog.stop).getTime()) === -1);
                    // rimuove dupplicati per start e end uguali a un altro programma
                    programs.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
                    let i = 0;
                    while (i < programs.length - 1) {
                        if (programs[i].start.getTime() === programs[i + 1].start.getTime() && programs[i].stop.getTime() === programs[i + 1].stop.getTime()) {
                            programs.splice(i + 1, 1);
                        } else {
                            i++;
                        }
                    }
                    schedule.push(...programs.map(prog => {
                        const haveIcon = prog.icon?.startsWith('http');
                        const previewImagePath = haveIcon ? this.getPreviewFilename(key, prog) : null;
                        const previewImageFetched: 'no' | 'yes' | 'not-exists' = haveIcon ? 'no' : 'not-exists';
                        return { ...prog, previewImagePath: previewImagePath, previewImageFetched: previewImageFetched }
                    }));

                    // remove programs old the 1 day
                    const now = Date.now();
                    const toRemove = schedule.filter(prog => prog.stop.getTime() < now - 24 * 60 * 60 * 1000);
                    for (const prog of toRemove) {
                        if (prog.previewImageFetched === 'yes' && prog.previewImagePath) {
                            try {
                                fs.unlinkSync(prog.previewImagePath);
                            } catch (err) {
                                // Ignore
                            }
                        }
                    }
                    schedules[key] = schedule.filter(prog => prog.stop.getTime() >= now - 24 * 60 * 60 * 1000)
                    // Sort schedules by start time
                    schedule.sort((a, b) => a.start.getTime() - b.start.getTime());
                }
            }
            for (const key of Object.keys(schedules)) {
                if (!keys.includes(key)) {
                    for (const prog of schedules[key]) {
                        if (prog.previewImageFetched === 'yes' && prog.previewImagePath) {
                            try {
                                fs.unlinkSync(prog.previewImagePath);
                            } catch (err) {
                                // Ignore
                            }
                        }
                    }
                    delete schedules[key];
                }
            }
        }
    }

    private async updateChannels() {
        for (const sourceKey of Object.keys(config.m3u.sources)) {
            const config_source = config.m3u.sources[sourceKey];
            if (!config_source.active) continue;
            const source = this.getSource(config_source, 'm3u', sourceKey);
            try {
                const response = await axios.get(config_source.url);
                const channels = parseM3U(source.id, response.data);
                const existing: string[] = []

                for (const channel of channels) {
                    existing.push(channel.id);
                    if (!(this.db.channels[channel.id])) {
                        console.log(`Adding new channel: ${channel.name} (${channel.id})`);
                        this.db.channels[channel.id] = {
                            ...channel,
                            logoCachedPath: null,
                            logoFetched: false,
                        };
                        if (!(channel.name.toLowerCase() in this.db.decode)) {
                            this.db.decode[channel.name.toLowerCase()] = [];
                        }
                        this.rankChannels(this.db.channels[channel.id]);
                        this.db.decode[channel.name.toLowerCase()].push(channel.id);
                    } else {
                        const channelRecord = this.db.channels[channel.id]
                        if (channelRecord.logo !== channel.logo) {
                            console.log(`Logo changed for channel ${channel.name}, updating...${channelRecord.logo} -> ${channel.logo}`);
                            if (channelRecord.logoCachedPath) {
                                try {
                                    fs.unlinkSync(channelRecord.logoCachedPath);
                                } catch (err) {
                                    // Ignore
                                }
                                channelRecord.logoCachedPath = null;
                                channelRecord.logoFetched = false;
                            }
                        }
                        if (channelRecord.stream !== channel.stream) {
                            // if something changed, update stream URL
                            channelRecord.stream = channel.stream;
                        }
                    }
                }

                // Remove deleted channels
                for (const channelId of Object.keys(this.db.channels)) {
                    if (!existing.includes(channelId)) {
                        const channelRecord = this.db.channels[channelId];
                        if (channelRecord.logoCachedPath) {
                            try {
                                fs.unlinkSync(channelRecord.logoCachedPath);
                            } catch (err) {
                                // Ignore
                            }
                        }
                        delete this.db.channels[channelId];
                        // remove key from array
                        const filtered = this.db.decode[channelRecord.name.toLowerCase()].filter(id => id !== channelId);
                        if (filtered.length === 0) {
                            delete this.db.decode[channelRecord.name.toLowerCase()];
                        } else {
                            this.db.decode[channelRecord.name.toLowerCase()] = filtered;
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching M3U:', (error as Error).message);
                throw new Error('Failed to fetch M3U playlist');
            }
        }
    }

    getPreviewFilename(domain: string, schedule: ProgramEntry): string {
        if (!schedule.icon?.startsWith('http'))
            throw new Error('Program has no preview icon');
        const typeMatch = schedule.icon.match(/\.([a-zA-Z]+)$/);
        const type = typeMatch ? typeMatch[1].toLocaleLowerCase() : 'jpg';
        return `${domain}-${crypto.createHash('md5').update(`${schedule.start.toISOString()}`).digest('hex')}.${type}`;
    }

    getProgramFromUrl(cryptFilename: string): ProgramRecord | undefined {
        const [domain, _] = cryptFilename.split('-');
        const programs = this.db.programs[domain] || [];
        return programs.find(prog => prog?.previewImagePath === cryptFilename);
    }

    waitingDomains = new Map<string, { stop: number, lastRequest: number, sleep: number }>();
    async getRemoteImage(url: string, filename?: string): Promise<{ filename: string | null, status: number }> {
        try {
            let retray = true;
            let count = 0
            const domain = (new URL(url)).hostname;
            let response: AxiosResponse = {} as AxiosResponse;
            while (retray && count < 3) {
                if (this.waitingDomains.has(domain)) {
                    const times = this.waitingDomains.get((new URL(url)).hostname)!;
                    if (Date.now() < times.lastRequest + (times.stop || times.sleep)) {
                        const waitTime = (times.stop || times.sleep);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                response = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3' } });
                if (response.status === 429) {
                    //guarda se ce retry-after
                    const retryAfter = response.headers['retry-after'];
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 30000;
                    if (this.waitingDomains.has(domain)) {
                        const existing = this.waitingDomains.get(domain)!;
                        existing.stop = waitTime;
                        existing.lastRequest = Date.now()
                        existing.sleep *= 2;
                    } else {
                        this.waitingDomains.set(domain, { stop: waitTime, lastRequest: Date.now(), sleep: 500 });
                    }
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    count++;
                } else {
                    if (this.waitingDomains.has(domain)) {
                        const times = this.waitingDomains.get(domain)!;
                        times.stop = 0;
                        times.lastRequest = Date.now();
                    }
                    retray = false;
                }
            }
            if (response.status !== 200)
                return { filename: null, status: response.status };
            const contentType = response.headers['content-type'] || ""
            const match = contentType.match(/^image\/(.+)$/)
            const ext = match[1] || 'jpg';
            if (!filename)
                filename = `${crypto.createHash('md5').update(url).digest('hex')}.${ext}`
            fs.writeFileSync(path.join(config.paths.images.dir, filename), response.data);
            return { filename, status: response.status };
        } catch (error) {
            process.stdout.write('Error fetching image: ' + (error as Error).message + '\r');
            return { filename: null, status: 0 }
        }
    }

    async cacheProgramPreview(imageUrl: string): Promise<'yes' | 'no' | 'not-exists'> {
        const program = this.getProgramFromUrl(imageUrl);
        if (!program)
            return 'no'
        if (program.previewImageFetched === 'no') {
            const response = await this.getRemoteImage(program.icon!, imageUrl);
            program.previewImageFetched = response.status === 200 ? 'yes' : 'not-exists';
            if (response.status !== 200) {
                program.previewImagePath = null;
                this.getPrograms(true);
            }
            this.database.save();
        }
        return program.previewImageFetched
    }




    /*
    OLD EVENT EMITTING LOGIC - TO BE REWRITTEN
    changes.forEach(change => {
        const previewUrl = `/api/epg-icon/${encodeURIComponent(change.channelId)}?v=${encodeURIComponent(change.programKey)}`;
        socket.emit('epg-icon-updated', { channelId: change.channelId, previewUrl });
      });
    }
    */


    async update() {
        try {
            console.log('Updating channels...');
            await this.updateChannels();
            console.log('Updating schedules...');
            await this.updateSchedules();
            console.log('Updating images...');
            await this.updateImages();
            console.log('Patching channels...');
            this.patchChannels();
            console.log('Finalizing updates...');
            this.getChannels(true);
            this.getPrograms(true);
            this.database.save();
            console.log('Update completed.');
            if (this.socket) {
                this.socket.emit('channels-updated', true);
                this.socket.emit('epg-updated', true);
                this.socket.emit('images-updated', true);
            }
            console.log(`Channels updated. Total channels: ${Object.keys(this.db.channels).length}`);
        } catch (err) {
            console.error('Error updating channels or schedules:', (err as Error).message);
        }
    }


    private async updateImages() {
        for (const channelId of Object.keys(this.db.channels)) {
            const channelRecord = this.db.channels[channelId];
            if (channelRecord.logo && !channelRecord.logoFetched && channelRecord.logo.startsWith('http')) {
                const response = await this.getRemoteImage(channelRecord.logo);
                channelRecord.logoCachedPath = response.status === 200 ? response.filename : null;
                channelRecord.logoFetched = true;
            }
        }
    }

    getBestChannel = (channels: ChannelRecord[]): ChannelRecord => {
        const list: { channel: ChannelRecord; score: number }[] = channels.map(c => ({ channel: c, score: parseInt(c.extra?.ranking) || 0 }));
        list.sort((a, b) => b.score - a.score);
        return list[0].channel;
    }

    getChannels(update: boolean = false): Record<string, ChannelFrontend> {
        if (!(update || Object.keys(this.database.cache.channels).length === 0))
            return this.database.cache.channels;

        const channels: Record<string, ChannelFrontend> = {};
        for (const name of Object.keys(this.db.decode)) {

            const ch = this.getBestChannel(this.getChannelByName(name));
            channels[ch.id] = ({
                id: ch.id,
                tvgNo: ch.tvgNo,
                tvgId: ch.id,
                name: ch.name,
                stream: ch.stream,
                logo: !ch.logoCachedPath ? null : path.join(config.paths.images.web, ch.logoCachedPath),
                group: ch.group || '',
                epgKey: ch.epgKey || '',
                isStreaming: ch.isActive || false
            });
        }
        this.database.cache.channels = channels;
        return channels;
    }

    getPrograms(update: boolean = false): Record<string, ProgramFrontend[]> {
        if (!(update || Object.keys(this.database.cache.epg).length === 0))
            return this.database.cache.epg;

        const epg: Record<string, ProgramFrontend[]> = {};

        // update cache programs
        for (let key of Object.keys(this.db.programs)) {
            epg[key] = this.db.programs[key].map((prog: ProgramRecord) => ({
                id: `${key}-${prog.start.toISOString()}`,
                start: prog.start,
                end: prog.stop,
                title: prog.title,
                desc: prog.desc,
                category: prog.category,
                preview: prog.previewImagePath ? path.join(config.paths.images.web, prog.previewImagePath) : null
            }));
        }
        this.database.cache.epg = epg;
        return epg;
    }

    patchChannels() {
        this.db.tabs = {};
        if (!config.tabs) return;

        const allChannelNames = new Set<string>();
        const cTabs: Record<string, ChannelRecord[]> = {};

        const matchesAny = (arr: { match: RegExp }[] | undefined, value: string) =>
            !arr || arr.some(m => m.match.test(value));

        const matchesNone = (arr: { match: RegExp }[] | undefined, value: string) =>
            !arr || !arr.some(m => m.match.test(value));

        const patch = (tab: Tab, channels: ChannelRecord[]) => {
            let start = tab.start ?? 1;

            let filtered = channels.filter(ch => {
                const source =
                    this.db.sources[Number(ch.extra.source ?? -1)]?.name ?? '';

                if (!matchesAny(tab.sources?.include, source)) return false;
                if (!matchesNone(tab.sources?.exclude, source)) return false;

                if (!matchesAny(tab.groups?.include, ch.group ?? '')) return false;
                if (!matchesNone(tab.groups?.exclude, ch.group ?? '')) return false;

                if (tab.and && !tab.and.test(ch.name)) return false;

                if (!matchesNone(tab.exclude, ch.name)) return false;

                return true;
            });

            filtered = filtered.filter(ch => {
                if (!tab.include) return true;

                const inc = tab.include.find(i => i.match.test(ch.name));
                if (!inc) return false;

                if (tab.start) ch.tvgNo = String(start++);

                Object.assign(ch, {
                    ...(tab.properties?.plain ?? {}),
                    ...(inc.properties?.plain ?? {})
                });

                Object.assign(ch.extra, {
                    ...(tab.properties?.extra ?? {}),
                    ...(inc.properties?.extra ?? {})
                });

                return true;
            });

            for (const ch of filtered) {
                ch.extra.tab = tab.name;
                allChannelNames.add(ch.name);
            }

            return filtered;
        };

        const tabOther = config.tabs.find(t => t.missing);
        const temps: Set<string> = new Set(config.tabs.filter(t => t.temp).map(t => t.name));

        for (const tab of config.tabs)
            if (!tab.missing)
                cTabs[tab.name] = patch(tab, Object.values(this.db.channels));

        if (tabOther) {
            const others = Object.values(this.db.channels).filter(
                ch => !allChannelNames.has(ch.name)
            );
            cTabs[tabOther.name] = patch(tabOther, others);
        }

        const merge = (channels: ChannelRecord[]): string[] => {
            const withNo = channels.every(ch => ch.tvgNo != null);

            if (withNo) {
                const map = new Map<string, number>();
                for (const ch of channels) {
                    const no = Number(ch.tvgNo);
                    if (!Number.isFinite(no)) continue;
                    map.set(ch.name, Math.min(map.get(ch.name) ?? no, no));
                }
                return [...map.entries()]
                    .sort((a, b) => a[1] - b[1])
                    .map(([name]) => name);
            }

            return [...new Set(channels.map(ch => ch.name))].sort();
        };

        for (const [name, chans] of Object.entries(cTabs))
            if (!temps.has(name))
                this.db.tabs[name] = merge(chans);
    }

    getTabs(): Record<string, string[]> {
        return this.db.tabs;
    }
}

const channelService = new ChannelService();
export { channelService };