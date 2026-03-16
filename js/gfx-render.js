/**
 * GBA 4bpp tile decode, tilemap compose, palette parse, canvas output.
 *
 * Each BG layer is rendered independently using its own decompressed tile
 * data. Tile IDs that exceed the layer's available tiles are skipped
 * (rendered as transparent). This produces correct results for L0/L1 and
 * a partial but glitch-free result for L2 foreground layers.
 */

import { readU16, readU32, romPtr, BG_TILE_TABLE, BG_TILEMAP_TABLE, BG_PALETTE_TABLE,
         BG_TILE_COUNT, BG_PALETTE_COUNT } from './rom-tables.js';
import { decompressAsset } from './decompress.js';

/** Convert GBA RGB555 (16-bit) to [r, g, b] array. */
function rgb555to888(c16) {
    return [
        (c16 & 0x1F) << 3,
        ((c16 >>> 5) & 0x1F) << 3,
        ((c16 >>> 10) & 0x1F) << 3,
    ];
}

/**
 * Parse GBA RGB555 palette bank into flat RGBA array.
 * @param {Uint8Array} data  raw palette bytes (32 bytes = 16 colors)
 * @param {number} numColors
 * @returns {Uint8Array} RGBA array (numColors * 4 bytes)
 */
function parsePaletteRGBA(data, numColors) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const rgba = new Uint8Array(numColors * 4);
    for (let i = 0; i < numColors; i++) {
        if (i * 2 + 1 >= data.length) break;
        const c16 = dv.getUint16(i * 2, true);
        const [r, g, b] = rgb555to888(c16);
        const off = i * 4;
        rgba[off] = r;
        rgba[off + 1] = g;
        rgba[off + 2] = b;
        rgba[off + 3] = 255;
    }
    rgba[3] = 0; // color index 0 = transparent
    return rgba;
}

/**
 * Decompress a BG asset and strip the 4-byte sub-header.
 */
function decompressBgAsset(rom, offset) {
    return decompressAsset(rom, offset).result.subarray(4);
}

// Cache for decompressed BG assets (keyed by offset)
const _decompCache = new Map();

function getCachedDecomp(rom, offset) {
    if (!_decompCache.has(offset)) {
        _decompCache.set(offset, decompressBgAsset(rom, offset));
    }
    return _decompCache.get(offset);
}

/** Clear the decompression cache (call when ROM changes). */
export function clearCache() {
    _decompCache.clear();
}

/**
 * Determine tilemap dimensions from decompressed data size.
 * @param {Uint8Array} tilemap
 * @returns {{ mapW: number, mapH: number }}
 */
function tilemapDims(tilemap) {
    const mapEntries = (tilemap.length / 2) | 0;
    if (mapEntries >= 2048) return { mapW: 64, mapH: 32 };
    if (mapEntries >= 1024) return { mapW: 32, mapH: 32 };
    return { mapW: 32, mapH: Math.max(1, (mapEntries / 32) | 0) };
}

/**
 * Compose a GBA background from tiles + tilemap + palette.
 * Returns an offscreen canvas, or null on failure.
 */
export function composeBg(tilesRaw, tilemapRaw, paletteRaw, mapW = 32, mapH = 32) {
    if (tilesRaw.length < 32 || tilemapRaw.length < 2) return null;

    const palBanks = [];
    for (let bank = 0; bank < 16; bank++) {
        const bankData = paletteRaw.subarray(bank * 32, bank * 32 + 32);
        palBanks.push(parsePaletteRGBA(bankData, 16));
    }

    const width = mapW * 8;
    const height = mapH * 8;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const pixels = imgData.data;

    const numTiles = (tilesRaw.length / 32) | 0;
    const tmapDv = new DataView(tilemapRaw.buffer, tilemapRaw.byteOffset, tilemapRaw.byteLength);

    for (let my = 0; my < mapH; my++) {
        for (let mx = 0; mx < mapW; mx++) {
            const idx = my * mapW + mx;
            if (idx * 2 + 1 >= tilemapRaw.length) continue;
            const entry = tmapDv.getUint16(idx * 2, true);
            const tileId = entry & 0x3FF;
            const hflip = (entry >>> 10) & 1;
            const vflip = (entry >>> 11) & 1;
            const palBank = (entry >>> 12) & 0xF;

            if (tileId >= numTiles) continue;

            const pal = palBanks[palBank];
            const tileOffset = tileId * 32;
            const pxX = mx * 8;
            const pxY = my * 8;

            for (let ty = 0; ty < 8; ty++) {
                for (let tx = 0; tx < 8; tx += 2) {
                    const byteIdx = tileOffset + ty * 4 + (tx >>> 1);
                    if (byteIdx >= tilesRaw.length) continue;
                    const byteVal = tilesRaw[byteIdx];
                    const lo = byteVal & 0x0F;
                    const hi = (byteVal >>> 4) & 0x0F;

                    let dx0, dx1, c0, c1;
                    if (hflip) {
                        dx0 = 7 - tx - 1; dx1 = 7 - tx;
                        c0 = hi; c1 = lo;
                    } else {
                        dx0 = tx; dx1 = tx + 1;
                        c0 = lo; c1 = hi;
                    }
                    const dy = vflip ? (7 - ty) : ty;

                    if (c0 !== 0) {
                        const x0 = pxX + dx0, y0 = pxY + dy;
                        if (x0 >= 0 && x0 < width && y0 < height) {
                            const p = (y0 * width + x0) * 4;
                            const s = c0 * 4;
                            pixels[p] = pal[s]; pixels[p+1] = pal[s+1];
                            pixels[p+2] = pal[s+2]; pixels[p+3] = 255;
                        }
                    }
                    if (c1 !== 0) {
                        const x1 = pxX + dx1, y1 = pxY + dy;
                        if (x1 >= 0 && x1 < width && y1 < height) {
                            const p = (y1 * width + x1) * 4;
                            const s = c1 * 4;
                            pixels[p] = pal[s]; pixels[p+1] = pal[s+1];
                            pixels[p+2] = pal[s+2]; pixels[p+3] = 255;
                        }
                    }
                }
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

/**
 * Composite 3 BG layer canvases (0=far, 1=mid, 2=near/foreground).
 * Tiles smaller layers to fill the max width. Color 0 = transparent.
 */
export function compositeLayers(layers) {
    let maxW = 0, maxH = 0;
    for (const c of layers) {
        if (c) { maxW = Math.max(maxW, c.width); maxH = Math.max(maxH, c.height); }
    }
    if (maxW === 0 || maxH === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = maxH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, maxW, maxH);

    for (const c of layers) {
        if (!c) continue;
        for (let x = 0; x < maxW; x += c.width) {
            for (let y = 0; y < maxH; y += c.height) {
                ctx.drawImage(c, x, y);
            }
        }
    }
    return canvas;
}

/**
 * Render a single BG layer from ROM (standalone, own tiles only).
 */
export function renderBgLayer(rom, dv, bgIdx, palIdx) {
    const tileOff = romPtr(dv, BG_TILE_TABLE + bgIdx * 4);
    const tmapOff = romPtr(dv, BG_TILEMAP_TABLE + bgIdx * 4);
    const palOff  = romPtr(dv, BG_PALETTE_TABLE + palIdx * 4);

    if (tileOff === null || tmapOff === null || palOff === null) return null;

    try {
        const tiles   = getCachedDecomp(rom, tileOff);
        const tilemap = getCachedDecomp(rom, tmapOff);
        const palRaw  = getCachedDecomp(rom, palOff);
        const { mapW, mapH } = tilemapDims(tilemap);
        return composeBg(tiles, tilemap, palRaw, mapW, mapH);
    } catch (e) {
        console.warn(`Failed to render BG layer ${bgIdx}:`, e);
        return null;
    }
}

/**
 * Render a composite of all 3 layers for a given vision/world.
 * Each layer is rendered independently with its own tile data.
 */
export function renderScene(rom, dv, vision, world) {
    const palIdx = (vision - 1) * 9 + world;
    const layerCanvases = [];
    for (let layer = 0; layer < 3; layer++) {
        const bgIdx = (vision - 1) * 27 + world * 3 + layer;
        layerCanvases.push(renderBgLayer(rom, dv, bgIdx, palIdx));
    }
    return {
        composite: compositeLayers(layerCanvases),
        layers: layerCanvases,
    };
}
