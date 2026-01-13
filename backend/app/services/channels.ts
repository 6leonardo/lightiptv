import axios from 'axios';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { getConfig, ConfigM3USource, ConfigXMLTVSource } from '../config/index.js';
import { parseM3U, ChannelEntry } from '../parsers/m3u.js';
import { parseXMLTV, ProgramEntry } from '../parsers/xmltv.js';
import { Server as SocketIOServer } from 'socket.io';

const config = getConfig();


interface ProgramRecord extends ProgramEntry {
    previewImagePath: string | null;
    previewImageFetched: 'no' | 'yes' | 'not-exists';
}

export interface ChannelRecord extends ChannelEntry {
    logoCachedPath: string | null;
    logoFetched?: boolean;
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
    url: string;
    type: 'm3u' | 'xmltv';
    id: string;
}

interface DBSchema {
    channels: Record<string, ChannelRecord>; // key is channel id
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

    init() {
        this.database.init();
    }

    getSource(source: ConfigM3USource | ConfigXMLTVSource, type: 'm3u' | 'xmltv'): Source {
        const existingSource = Object.values(this.database.db.sources).find(src => src.url === source.url && src.type === type);
        if (existingSource) {
            return existingSource;
        }
        const newSource: Source = {
            url: source.url,
            type,
            id: `source-${this.database.db.ids.source++}`
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

    async updateSchedules() {
        const keys: string[] = []
        for (const sourceKey of Object.keys(config.xmltv.sources)) {
            const config_source = config.xmltv.sources[sourceKey];
            const responseXML = await axios.get(config_source.url);
            const { epgData, channels } = await parseXMLTV(responseXML.data);
            const schedules = this.db.programs;
            for (const channelRecord of Object.values(this.db.channels)) {
                let key: string = channelRecord.domain;
                if (key in epgData) {

                } else if (channelRecord.channelID in epgData) {
                    key = channelRecord.channelID;
                } else if (channelRecord.tvgid in epgData) {
                    key = channelRecord.tvgid;
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
                }
                delete schedules[key];
            }
            this.database.save();
        }

        await this.updateImages();
        const epgCacheData: Record<string, ProgramFrontend[]> = {};

        // update cache programs
        for (let key of Object.keys(this.db.programs)) {
            epgCacheData[key] = this.db.programs[key].map((prog: ProgramRecord) => ({
                id: `${key}-${prog.start.toISOString()}`,
                start: prog.start,
                end: prog.stop,
                title: prog.title,
                desc: prog.desc,
                category: prog.category,
                preview: prog.previewImagePath ? path.join(config.paths.images.web, prog.previewImagePath) : null
            }));
        }
        this.database.save();
        this.cache.epg = epgCacheData;
        if (this.socket)
            this.socket.emit('epg-updated', true);
    }

    async updateChannels() {
        const channelChecksum = crypto.createHash('md5').update(JSON.stringify(this.db.channels)).digest('hex');
        for (const sourceKey of Object.keys(config.m3u.sources)) {
            const config_source = config.m3u.sources[sourceKey];
            if (!config_source.active) continue;
            const source = this.getSource(config_source, 'm3u');
            try {

                const response = await axios.get(config_source.url);
                const channels = parseM3U(source.id, response.data);
                const existing: string[] = []

                for (const channel of channels) {
                    existing.push(channel.id);
                    if (!this.db.channels[channel.id]) {
                        this.db.channels[channel.id] = {
                            ...channel,
                            logoCachedPath: null,
                        };
                        if (!this.db.decode[channel.name.toLowerCase()]) {
                            this.db.decode[channel.name.toLowerCase()] = [];
                        }
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
                }
            } catch (error) {
                console.error('Error fetching M3U:', (error as Error).message);
                throw new Error('Failed to fetch M3U playlist');
            }
        }

        try {
            if (this.socket) {
                this.database.save();
                this.socket.emit('channels-updated', true);
            }
            console.log(`Channels updated. Total channels: ${Object.keys(this.db.channels).length}`);
            this.cache.channels = this.channels
            await this.updateSchedules();
        } catch (error) {
            console.error('Error updating channels:', (error as Error).message);
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
        const programs = this.db.programs[domain.toLowerCase()] || [];
        return programs.find(prog => prog?.previewImagePath === cryptFilename);
    }

    async getRemoteImage(url: string, filename?: string): Promise<string | null> {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const contentType = response.headers['content-type'] || ""
            const match = contentType.match(/^image\/(.+)$/)
            if (!match)
                throw new Error('Invalid image content type');

            const ext = match[1]
            if (!filename)
                filename = `${crypto.createHash('md5').update(url).digest('hex')}.${ext}`
            fs.writeFileSync(path.join(config.paths.images.dir, filename), response.data);
            return filename;
        } catch (error) {
            console.error('Error fetching image:', (error as Error).message);
            return null;
        }
    }

    async cacheProgramPreview(imageUrl: string): Promise<Boolean> {
        const program = this.getProgramFromUrl(imageUrl);
        if (!program) {
            throw new Error('Preview URL not found');
        }
        if (program.previewImageFetched !== 'no') {
            try {
                await this.getRemoteImage(program.icon!, imageUrl);
                program.previewImageFetched = 'yes';
            } catch (err) {
                program.previewImageFetched = 'not-exists';
            }
            this.database.save();
        }
        return program.previewImageFetched === 'yes';
    }




    /*
    OLD EVENT EMITTING LOGIC - TO BE REWRITTEN
    changes.forEach(change => {
        const previewUrl = `/api/epg-icon/${encodeURIComponent(change.channelId)}?v=${encodeURIComponent(change.programKey)}`;
        socket.emit('epg-icon-updated', { channelId: change.channelId, previewUrl });
      });
    }
    */


    async updateImages() {
        const updates: { channelId: string; logo?: string }[] = [];

        for (const channelId of Object.keys(this.db.channels)) {
            const channelRecord = this.db.channels[channelId];
            const update: { channelId: string; logo?: string, previews: { start: Date, image: string }[] } = { channelId, previews: [] };

            // Fetch logo if not fetched
            if (channelRecord.logo && !channelRecord.logoFetched) {
                try {
                    const cachedLogo = await this.getRemoteImage(channelRecord.logo);
                    if (!cachedLogo) throw new Error('Failed to fetch logo');
                    channelRecord.logoCachedPath = cachedLogo;
                    update.logo = cachedLogo;
                }
                catch (err) {
                    channelRecord.logoCachedPath = null;
                }
                channelRecord.logoFetched = true;
            }
            if (update.logo)
                updates.push(update);
        }
        this.database.save();
        if (this.socket && updates.length > 0)
            this.socket.emit('images-update', updates);
    }

    get channels(): Record<string, ChannelFrontend> {
        const channels: Record<string, ChannelFrontend> = {};
        for (const key of Object.keys(this.db.channels)) {
            const ch = this.db.channels[key];
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
        return channels;
    }
}

const channelService = new ChannelService();
export { channelService };
