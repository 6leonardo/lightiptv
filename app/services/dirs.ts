import CONFIG from "../config/index.js";
import fs from 'fs';


export function initDirs() {
    for (const obj in CONFIG) {
        const key = obj as keyof typeof CONFIG;
        const value = CONFIG[key];
        if (typeof value === 'object' && value !== null && 'DIR' in value && typeof value.DIR === 'string') {
            const dirPath = value.DIR;
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`Created directory: ${dirPath}`);
            }
        }
    }
}

