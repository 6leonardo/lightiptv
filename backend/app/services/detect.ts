import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function resolveStreamUrl(url: string): Promise<string> {
    try {
        const { stdout } = await execFileAsync("curl", [
            "-s",            // silenzioso
            "-D", "-",       // header su stdout
            "-o", "/dev/null", // scarta body
            "-A", "Threadfin",
            url,
        ]);


        const lines = stdout.split("\n");

        const statusCode = lines[0].split(" ")[1];
        if (statusCode && (statusCode.startsWith("3"))) {
            console.log("[resolver] detected redirect with status code", statusCode);
        }

        if (statusCode == "302") {
            const locationLine = lines.find(l =>
                l.toLowerCase().startsWith("location:")
            );
            if (locationLine) {
                const location = locationLine.split(": ")[1].trim();
                console.log("[resolver] redirect ->", location);
                return location;
            }
        }

        console.log("[resolver] no redirect, using original URL");
        return url;

    } catch (err) {
        console.error("[resolver] curl failed, fallback to original URL");
        return url;
    }
}
