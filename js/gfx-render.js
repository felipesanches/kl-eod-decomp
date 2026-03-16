/**
 * GBA 4bpp tile decode, tilemap compose, palette parse, canvas output.
 *
 * On GBA hardware, all BG layers share a single VRAM tile space. The game
 * loads tile data from all layers sequentially into VRAM, and each layer's
 * tilemap references tiles by absolute position in this combined space.
 * We replicate this by building a unified tile buffer from all 3 layers.
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
 * Decompress a BG asset (returns raw result INCLUDING 4-byte sub-header).
 */
function decompressBgAssetRaw(rom, offset) {
    return decompressAsset(rom, offset).result;
}

/**
 * Decompress a BG asset and strip the 4-byte sub-header.
 */
function decompressBgAsset(rom, offset) {
    return decompressBgAssetRaw(rom, offset).subarray(4);
}

// Cache for decompressed BG assets (keyed by offset)
const _decompCacheRaw = new Map();
const _decompCache = new Map();

function getCachedDecompRaw(rom, offset) {
    if (!_decompCacheRaw.has(offset)) {
        _decompCacheRaw.set(offset, decompressBgAssetRaw(rom, offset));
    }
    return _decompCacheRaw.get(offset);
}

function getCachedDecomp(rom, offset) {
    if (!_decompCache.has(offset)) {
        _decompCache.set(offset, decompressBgAsset(rom, offset));
    }
    return _decompCache.get(offset);
}

/** Clear the decompression cache (call when ROM changes). */
export function clearCache() {
    _decompCacheRaw.clear();
    _decompCache.clear();
}

/**
 * Build a 1024-tile linear view for a layer based on its CBB.
 * Tile N in the tilemap maps to VRAM byte (CBB*0x4000 + N*32) mod 0x10000.
 * We rearrange the 64KB VRAM into a linear 1024-tile array for this CBB.
 * @param {Uint8Array} vram  64KB VRAM buffer
 * @param {number} cbb  charblock base (0-3)
 * @returns {Uint8Array}  1024 tiles * 32 bytes = 32KB
 */
function buildLayerTileView(vram, cbb) {
    const view = new Uint8Array(1024 * 32);
    const base = cbb * 0x4000;
    for (let t = 0; t < 1024; t++) {
        const srcAddr = (base + t * 32) & 0xFFFF; // 64KB wrap
        view.set(vram.subarray(srcAddr, srcAddr + 32), t * 32);
    }
    return view;
}

/**
 * Build a 64KB VRAM tile buffer from 3 layers' tile data.
 *
 * On GBA hardware, each BG layer has a Character Base Block (CBB) setting
 * that determines where in VRAM its tile data lives. The CBB is encoded
 * in byte[1] bits 7-6 of each layer's decompressed tile sub-header.
 * Each charblock is 16KB (512 tiles). VRAM addresses wrap at 64KB.
 *
 * Each layer's tilemap uses tile IDs relative to its own CBB, but high
 * tile IDs can wrap around to reference tiles from other charblocks.
 *
 * @param {Uint8Array[]} tileResults  array of 3 raw decompressed results (WITH 4-byte header)
 * @returns {{ vram: Uint8Array, cbbs: number[] }}
 */
function buildVRAM(tileResults) {
    const vram = new Uint8Array(0x10000); // 64KB
    const cbbs = [];

    for (const result of tileResults) {
        const cbb = (result.length > 1) ? (result[1] >> 6) & 3 : 0;
        cbbs.push(cbb);
        const tiles = result.subarray(4);
        const vramBase = cbb * 0x4000;
        const copyLen = Math.min(tiles.length, 0x10000 - vramBase);
        if (copyLen > 0) vram.set(tiles.subarray(0, copyLen), vramBase);
    }

    return { vram, cbbs };
}

/**
 * Compose a GBA background from tiles + tilemap + palette.
 * Returns an offscreen canvas, or null on failure.
 * @param {Uint8Array} tilesRaw    4bpp tile charblock data (can be combined)
 * @param {Uint8Array} tilemapRaw  screenblock entries (u16 per cell)
 * @param {Uint8Array} paletteRaw  512 bytes, 16 banks x 16 colors
 * @param {number} mapW  tilemap width in tiles
 * @param {number} mapH  tilemap height in tiles
 * @returns {HTMLCanvasElement|null}
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
 * @param {(HTMLCanvasElement|null)[]} layers  array of 3 canvases
 * @returns {HTMLCanvasElement|null}
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
 * Determine tilemap dimensions from decompressed data size.
 * @param {Uint8Array} tilemap  decompressed tilemap data
 * @returns {{ mapW: number, mapH: number }}
 */
function tilemapDims(tilemap) {
    const mapEntries = (tilemap.length / 2) | 0;
    if (mapEntries >= 2048) return { mapW: 64, mapH: 32 };
    if (mapEntries >= 1024) return { mapW: 32, mapH: 32 };
    return { mapW: 32, mapH: Math.max(1, (mapEntries / 32) | 0) };
}

/**
 * Render a composite of all 3 layers for a given vision/world.
 *
 * On GBA hardware, all BG layers share VRAM. The game loads each layer's
 * tile data into consecutive VRAM regions. We replicate this by building
 * a combined tile buffer (L0 tiles, then L1, then L2) so that each
 * layer's tilemap can reference tiles from any layer's data.
 *
 * @param {Uint8Array} rom
 * @param {DataView} dv
 * @param {number} vision  1-6
 * @param {number} world   0-8
 * @returns {{ composite: HTMLCanvasElement|null, layers: (HTMLCanvasElement|null)[] }}
 */
export function renderScene(rom, dv, vision, world) {
    const palIdx = (vision - 1) * 9 + world;
    const palOff = romPtr(dv, BG_PALETTE_TABLE + palIdx * 4);
    if (palOff === null) return { composite: null, layers: [null, null, null] };

    let palRaw;
    try { palRaw = getCachedDecomp(rom, palOff); }
    catch (e) { return { composite: null, layers: [null, null, null] }; }

    // Decompress all 3 layers' tile data (raw, WITH sub-header for CBB extraction)
    const tileResults = []; // raw decompressed results (with 4-byte header)
    const tileDatas = [];   // stripped tile data (without 4-byte header)
    const tilemapDatas = [];
    for (let layer = 0; layer < 3; layer++) {
        const bgIdx = (vision - 1) * 27 + world * 3 + layer;
        const tileOff = romPtr(dv, BG_TILE_TABLE + bgIdx * 4);
        const tmapOff = romPtr(dv, BG_TILEMAP_TABLE + bgIdx * 4);

        if (tileOff === null || tmapOff === null) {
            tileResults.push(new Uint8Array(4));
            tileDatas.push(new Uint8Array(0));
            tilemapDatas.push(new Uint8Array(0));
            continue;
        }
        try {
            const raw = getCachedDecompRaw(rom, tileOff);
            tileResults.push(raw);
            tileDatas.push(raw.subarray(4));
            tilemapDatas.push(getCachedDecomp(rom, tmapOff));
        } catch (e) {
            tileResults.push(new Uint8Array(4));
            tileDatas.push(new Uint8Array(0));
            tilemapDatas.push(new Uint8Array(0));
        }
    }

    // Build 64KB VRAM with each layer's tiles at its charblock base
    const { vram, cbbs } = buildVRAM(tileResults);

    // Render each layer. For tile lookup, use the VRAM with CBB-based addressing.
    const layerCanvases = [];
    for (let layer = 0; layer < 3; layer++) {
        if (tilemapDatas[layer].length < 2) {
            layerCanvases.push(null);
            continue;
        }
        const { mapW, mapH } = tilemapDims(tilemapDatas[layer]);
        // Create a tile view for this layer: tile N -> VRAM[(CBB*0x4000 + N*32) % 0x10000]
        const cbb = cbbs[layer];
        const layerTiles = buildLayerTileView(vram, cbb);
        layerCanvases.push(composeBg(layerTiles, tilemapDatas[layer], palRaw, mapW, mapH));
    }

    return {
        composite: compositeLayers(layerCanvases),
        layers: layerCanvases,
    };
}

/**
 * Render a single BG layer from ROM (standalone, no combined tiles).
 * Used for individual layer display.
 * @param {Uint8Array} rom
 * @param {DataView} dv
 * @param {number} bgIdx   index into tile/tilemap tables (0-161)
 * @param {number} palIdx  index into palette table (0-53)
 * @returns {HTMLCanvasElement|null}
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
