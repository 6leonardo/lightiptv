import { getConfig } from "../config/index.js";
import fs from 'fs';


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
}

