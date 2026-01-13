#!/usr/bin/env node

import readline from 'readline'
const re =
  /^tvg-id="(?<domain>[^\s@"]+)(?:@(?:(?<quality>720|1080|4K|SD|HD|FHD|UHD)|(?<region>[A-Za-z][A-Za-z0-9+-]*)(?<quality2>720|1080|4K|SD|HD|FHD|UHD)?))?"$/;

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const input = line.trim();
  if (!input) return;

  const m = input.match(re);

  if (!m) {
    console.error(
      JSON.stringify({ input, error: "NO_MATCH" })
    );
    return;
  }

  const { domain, region, quality } = m.groups;

  console.log(
    JSON.stringify({
      input,
      domain,
      region: region ?? null,
      quality: quality ?? null,
    })
  );
});
	

