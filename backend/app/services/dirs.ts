import { CONFIG_YML_PATH, getConfig } from "../config/index.js";
import fs from 'fs';
import path from "path";


export function initDirs() {
    const config = getConfig();
    for (const obj in config.paths) {
        const key = obj as keyof typeof config.paths;
        const value = config.paths[key];
        if (typeof value === 'object' && value !== null && 'dir' in value && typeof value.dir === 'string') {
            const dirPath = value.dir;
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`Created directory: ${dirPath}`);
            }
        }
    }

    const backupDir = config.paths.backups.dir;

    if (fs.existsSync(CONFIG_YML_PATH)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = path.join(backupDir, `config-${timestamp}.yml`);
        fs.copyFileSync(CONFIG_YML_PATH, backupPath);
    }
}
