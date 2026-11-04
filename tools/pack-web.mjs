#!/usr/bin/env node
/**
 * Packs a web build (dist/) into one gzip'ed JSON file for the Momentum-Host's auto-update:
 *   node tools/pack-web.mjs <dist> <out.json.gz> [build] [version]
 * Format: { format: 'momentum-web-1', build, version, files: { "<relative path>": "<base64>" } }
 * (JSON instead of zip so the host can unpack it with Node's zlib alone.)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const [dist, out, build = '0', version = ''] = process.argv.slice(2)
if (!dist || !out) {
  console.error('usage: node tools/pack-web.mjs <dist> <out.json.gz> [build] [version]')
  process.exit(1)
}
const files = {}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else files[relative(dist, p).split(sep).join('/')] = readFileSync(p).toString('base64')
  }
}
walk(dist)
if (!files['index.html']) {
  console.error(`${dist} has no index.html`)
  process.exit(1)
}
const buf = gzipSync(Buffer.from(JSON.stringify({ format: 'momentum-web-1', build: Number(build), version, files })), { level: 9 })
writeFileSync(out, buf)
console.log(`${out}: ${Object.keys(files).length} files, ${(buf.length / 1024).toFixed(0)} KiB, sha256 ${createHash('sha256').update(buf).digest('hex')}`)
