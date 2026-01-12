import axios from 'axios';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import CONFIG from '../config/index.js';
import { parseM3U, ChannelEntry } from '../parsers/m3u.js';
import { parseXMLTV, ProgramEntry } from '../parsers/xmltv.js';
import { Server as SocketIOServer } from 'socket.io';



interface ProgramRecord extends ProgramEntry {
    previewImagePath: string | null;
    previewImageFetched?: boolean;
}

interface ChannelRecord extends ChannelEntry {
    logoCachedPath: string | null;
    logoFetched?: boolean;
    isActive?: boolean;
    schedules: ProgramRecord[];
}

interface ChannelFrontend {
    tvgId: string;
    name: string;
    stream: string;
    logo: string | null;
    group: string;
    isStreaming: boolean;
}

interface ProgramFrontend {
    start: Date;
    stop: Date;
    title?: string;
    desc?: string;
    category?: string;
    preview: string | null;
}

interface DBSchema {
    channels: { [channelId: string]: ChannelRecord };
    decode: { [key: string]: string };
    programsCache: ProgramFrontend[][];

}


class Database {
    db: DBSchema = { channels: {}, decode: {}, programsCache: [] };

    init() {
        this.read();
    }

    read() {
        try {
            const data = JSON.parse(fs.readFileSync(CONFIG.CHANNELS.DB, 'utf-8'), (key, value) => {
                if (key === 'start' || key === 'stop') {
                    return new Date(value);
                }
                return value;
            });
            this.db = data;
        } catch (error) {
            this.db = { channels: {}, decode: {}, programsCache: [] };
            this.save();
        }

        return this.db;
    }

    save() {
        fs.writeFileSync(CONFIG.CHANNELS.DB, JSON.stringify(this.db, (key, value) => {
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

    getChannelByName(name: string): ChannelRecord | null {
        const channelId = this.database.db.decode[name.toLowerCase()];
        if (channelId) {
            return this.database.db.channels[channelId] || null;
        }
        return null;
    }

    get db() { return this.database.db; }

    async updateSchedules() {
        const responseXML = await axios.get(CONFIG.THREADFIN_XMLTV_URL);
        const { epgData, channels } = await parseXMLTV(responseXML.data);

        for (const channelRecord of Object.values(this.db.channels)) {
            if (epgData[channelRecord.tvgId]) {
                const programs = epgData[channelRecord.tvgId].filter(prog => 
                    channelRecord.schedules.findIndex(existingProg =>
                        existingProg.start.getTime() === new Date(prog.start).getTime()) === -1);
                // rimuove dupplicati per start e end uguali a un altro programma
                programs.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
                let i=0;
                while (i < programs.length - 1) {
                    if (programs[i].start.getTime() === programs[i+1].start.getTime() && programs[i].stop.getTime() === programs[i+1].stop.getTime()) {
                        programs.splice(i+1, 1);
                    } else {
                        i++;
                    }
                }
                channelRecord.schedules.push(...programs.map(prog => ({
                    ...prog,
                    previewImagePath: null
                })));

                // remove programs old the 1 day
                const now = Date.now();
                const toRemove = channelRecord.schedules.filter(prog => prog.stop.getTime() < now - 24 * 60 * 60 * 1000);
                for (const prog of toRemove) {
                    if (prog.previewImagePath) {
                        try {
                            fs.unlinkSync(prog.previewImagePath);
                        } catch (err) {
                            // Ignore
                        }
                    }
                }
                channelRecord.schedules = channelRecord.schedules.filter(prog => prog.stop.getTime() >= now - 24 * 60 * 60 * 1000);
                // Sort schedules by start time
                channelRecord.schedules.sort((a, b) => a.start.getTime() - b.start.getTime());
            } else {
                // No schedules for this channel anymore
                for (const program of channelRecord.schedules) {
                    if (program.previewImagePath) {
                        try {
                            fs.unlinkSync(program.previewImagePath);
                        } catch (err) {
                            // Ignore
                        }
                    }
                }
                channelRecord.schedules = [];
            }
        }

        this.database.save();
        await this.updateImages();
        const oldProgramsCacheHash = crypto.createHash('md5').update(JSON.stringify(this.db.programsCache)).digest('hex');
        this.db.programsCache = [];

        // update cache programs
        Object.values(this.db.channels).forEach((channel: ChannelRecord) => {
            const programFrontends: ProgramFrontend[] = channel.schedules.map((prog: ProgramRecord) => ({
                start: prog.start,
                stop: prog.stop,
                title: prog.title,
                desc: prog.desc,
                category: prog.category,
                preview: prog.previewImagePath ? CONFIG.IMAGES.DIR_WEB + '/' + prog.previewImagePath : null
            }));
            if (programFrontends.length > 0)
                this.db.programsCache.push(programFrontends);
        })

        this.database.save();
        const newProgramsCacheHash = crypto.createHash('md5').update(JSON.stringify(this.db.programsCache)).digest('hex');
        if (this.socket && oldProgramsCacheHash !== newProgramsCacheHash) {
            this.socket.emit('epg-updated', true);
        }
    }

    async updateChannels() {
        try {
            const response = await axios.get(CONFIG.THREADFIN_M3U_URL);
            const channels = parseM3U(response.data);
            const existing: string[] = []
            const channelChecksum = crypto.createHash('md5').update(JSON.stringify(this.db.channels)).digest('hex');

            for (const channel of channels) {
                existing.push(channel.id);
                if (!this.db.channels[channel.id] || this.db.channels[channel.id].name !== channel.name) {
                    this.db.channels[channel.id] = {
                        ...channel,
                        logoCachedPath: null,
                        schedules: []
                    };
                    this.db.decode[channel.name.toLowerCase()] = channel.id;
                } else {
                    const channelRecord = this.db.channels[channel.id]
                    if (channelRecord.logo !== channel.logo) {
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
                    for (const program of channelRecord.schedules) {
                        if (program.previewImagePath) {
                            try {
                                fs.unlinkSync(program.previewImagePath);
                            } catch (err) {
                                // Ignore
                            }
                        }
                    }
                    delete this.db.channels[channelId];
                    delete this.db.decode[channelRecord.name.toLowerCase()];
                }
            }
            const newChecksum = crypto.createHash('md5').update(JSON.stringify(this.db.channels)).digest('hex');
            const channelChanged = channelChecksum !== newChecksum;
            if (this.socket && channelChanged) {
                this.socket.emit('channels-updated', true);
            }
            console.log(`Channels updated. Total channels: ${Object.keys(this.db.channels).length}`);
            await this.updateSchedules();

        } catch (error) {
            console.error('Error fetching M3U:', (error as Error).message);
            throw new Error('Failed to fetch M3U playlist');
        }
    }

    async getRemoteImage(url: string): Promise<string | null> {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const contentType = response.headers['content-type'] || ""
            const match = contentType.match(/^image\/(.+)$/)
            if (!match)
                throw new Error('Invalid image content type');

            const ext = match[1]
            const filename = `${crypto.createHash('md5').update(url).digest('hex')}.${ext}`
            fs.writeFileSync(path.join(CONFIG.IMAGES.DIR, filename), response.data);
            return filename;
        } catch (error) {
            console.error('Error fetching image:', (error as Error).message);
            return null;
        }
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
        const updates: { channelId: string; logo?: string, previews: { start: Date, image: string }[] }[] = [];

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
            // Fetch program preview images
            for (const program of channelRecord.schedules) {
                if (program.icon && !program.previewImageFetched) {
                    try {
                        const cachedPreview = await this.getRemoteImage(program.icon);
                        if (!cachedPreview) throw new Error('Failed to fetch preview image');
                        program.previewImagePath = cachedPreview;
                        update.previews.push({ start: program.start, image: cachedPreview });
                    } catch (err) {
                        program.previewImagePath = null;
                    }
                    program.previewImageFetched = true;
                }
            }
            if (update.logo || update.previews.length > 0) {
                updates.push(update);
            }
        }
        this.database.save();
        if (this.socket && updates.length > 0)
            this.socket.emit('images-update', updates);
    }

    get channels(): ChannelFrontend[] {
        const channels = Object.values(this.db.channels).map(ch => ({
            tvgId: ch.tvgId,
            name: ch.name,
            stream: ch.stream,
            logo: !ch.logoCachedPath ? 'none' : CONFIG.IMAGES.DIR_WEB + '/' + ch.logoCachedPath,
            group: ch.group || '',
            isStreaming: ch.isActive || false
        }));

        return channels;
    }
}

const channelService = new ChannelService();
export { channelService };
