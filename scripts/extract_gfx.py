"""Extract graphics assets from Klonoa: Empire of Dreams ROM.

Walks three ROM tables (GFX_ASSET_TABLE, TILESET_TABLE, SPRITE_FRAME_TABLE),
extracts compressed blobs, decompresses them, and renders PNGs for visual
inspection. Compressed .bin files are byte-exact copies from ROM for use in
the build system.

Usage:
    python scripts/extract_gfx.py [baserom.gba]
"""

import json
import math
import os
import struct
import sys

from gba_decompress import bios_huffman_decompress, bios_lz77_decompress, decompress_asset

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)

ROM_PATH = "baserom.gba"
OUT_DIR = "graphics"

# ROM table addresses (from include/globals.h)
ROM_GFX_ASSET_TABLE = 0x18B7AC
ROM_TILESET_TABLE = 0x18B8E0
ROM_SPRITE_FRAME_TABLE = 0x78FC8

# Default grayscale palette for 4bpp (16 colors)
GRAYSCALE_4BPP = [(i * 17, i * 17, i * 17) for i in range(16)]

# Default grayscale palette for 8bpp (256 colors)
GRAYSCALE_8BPP = [(i, i, i) for i in range(256)]


def gba_rgb555_to_rgb888(color16):
    """Convert GBA RGB555 (16-bit) to RGB888 tuple."""
    r = (color16 & 0x1F) << 3
    g = ((color16 >> 5) & 0x1F) << 3
    b = ((color16 >> 10) & 0x1F) << 3
    return (r, g, b)


def parse_palette(data, offset, num_colors=16):
    """Parse GBA RGB555 palette data into list of RGB888 tuples."""
    colors = []
    for i in range(num_colors):
        if offset + i * 2 + 1 >= len(data):
            colors.append((0, 0, 0))
            continue
        c16 = struct.unpack_from('<H', data, offset + i * 2)[0]
        colors.append(gba_rgb555_to_rgb888(c16))
    return colors


def render_4bpp_tiles(tile_data, palette, tiles_per_row=16):
    """Render 4bpp GBA tile data as a PIL Image.

    Each tile is 8x8 pixels, 32 bytes (4 bits per pixel).
    """
    if len(tile_data) < 32:
        return None

    num_tiles = len(tile_data) // 32
    if num_tiles == 0:
        return None

    cols = min(tiles_per_row, num_tiles)
    rows = math.ceil(num_tiles / cols)
    width = cols * 8
    height = rows * 8

    img = Image.new('RGB', (width, height), (0, 0, 0))
    pixels = img.load()

    for t in range(num_tiles):
        tx = (t % cols) * 8
        ty = (t // cols) * 8
        tile_offset = t * 32

        for y in range(8):
            for x in range(0, 8, 2):
                byte_idx = tile_offset + y * 4 + x // 2
                if byte_idx >= len(tile_data):
                    continue
                byte = tile_data[byte_idx]
                # Low nibble = left pixel, high nibble = right pixel
                px_left = byte & 0x0F
                px_right = (byte >> 4) & 0x0F
                if tx + x < width and ty + y < height:
                    pixels[tx + x, ty + y] = palette[px_left]
                if tx + x + 1 < width and ty + y < height:
                    pixels[tx + x + 1, ty + y] = palette[px_right]

    return img


def render_8bpp_tiles(tile_data, palette, tiles_per_row=16):
    """Render 8bpp GBA tile data as a PIL Image.

    Each tile is 8x8 pixels, 64 bytes (8 bits per pixel).
    """
    if len(tile_data) < 64:
        return None

    num_tiles = len(tile_data) // 64
    if num_tiles == 0:
        return None

    cols = min(tiles_per_row, num_tiles)
    rows = math.ceil(num_tiles / cols)
    width = cols * 8
    height = rows * 8

    img = Image.new('RGB', (width, height), (0, 0, 0))
    pixels = img.load()

    for t in range(num_tiles):
        tx = (t % cols) * 8
        ty = (t // cols) * 8
        tile_offset = t * 64

        for y in range(8):
            for x in range(8):
                byte_idx = tile_offset + y * 8 + x
                if byte_idx >= len(tile_data):
                    continue
                px = tile_data[byte_idx]
                if px < len(palette) and tx + x < width and ty + y < height:
                    pixels[tx + x, ty + y] = palette[px]

    return img


def find_compressed_size(rom, offset):
    """Determine the compressed size of an asset starting at offset.

    Reads the asset header and walks the compressed data to find its end.
    For Huffman+LZ77: header(4) + huffman_stream
    For LZ77 only: header(4) + lz77_stream
    """
    header = struct.unpack_from('<I', rom, offset)[0]
    is_huffman = bool(header & 0x80000000)

    if is_huffman:
        # Header(4) + Huffman data
        huff_offset = offset + 4
        huff_header = struct.unpack_from('<I', rom, huff_offset)[0]
        huff_decomp_size = (huff_header >> 8) & 0xFFFFFF

        tree_size_half = rom[huff_offset + 4]
        treesize = tree_size_half * 2 + 1
        bitstream_raw = huff_offset + treesize + 1
        bitstream_start = (bitstream_raw + 3) & ~3

        # Estimate: the huffman bitstream encodes huff_decomp_size bytes
        # We can't easily compute the exact end without decoding, so
        # we'll find where the next asset starts or use a generous bound
        # For now, use the next table entry as boundary
        return None  # Will use table-based sizing
    else:
        # LZ77 only - similar issue, can't easily find end without decoding
        return None


def extract_gfx_assets(rom, manifest):
    """Extract assets from ROM_GFX_ASSET_TABLE."""
    print("\n=== Extracting GFX Assets ===")

    # Read table entries
    entries = []
    pos = ROM_GFX_ASSET_TABLE
    while True:
        val = struct.unpack_from('<I', rom, pos)[0]
        if val < 0x08000000 or val > 0x08400000:
            break
        entries.append(val - 0x08000000)
        pos += 4

    print(f"Found {len(entries)} GFX asset entries")

    # Determine asset boundaries for compressed blob extraction
    # Sort unique offsets to find boundaries
    unique_offsets = sorted(set(entries))

    for i, offset in enumerate(entries):
        asset_info = {
            "table": "GFX_ASSET_TABLE",
            "index": i,
            "rom_offset": f"0x{offset:06X}",
        }

        header = struct.unpack_from('<I', rom, offset)[0]
        is_huffman = bool(header & 0x80000000)
        decomp_size = header & 0x7FFFFFFF

        # Detect palette entries: first 2 bytes are 0x0000 (GBA transparent black),
        # followed by non-zero GBA RGB555 color values. These are NOT compressed.
        is_palette = False
        if not is_huffman and offset + 4 < len(rom):
            first_halfword = struct.unpack_from('<H', rom, offset)[0]
            if first_halfword == 0x0000 and decomp_size > 0:
                # Check second halfword is a plausible GBA color (non-zero, < 0x8000)
                second_halfword = struct.unpack_from('<H', rom, offset + 2)[0]
                if 0 < second_halfword < 0x8000:
                    is_palette = True

        if decomp_size == 0 or is_palette:
            asset_info["type"] = "raw"
            asset_info["size"] = 0

            if is_palette or 12 <= i <= 20:
                # These are palette data (arrays of GBA RGB555 colors)
                # Determine size from spacing between entries
                idx_in_unique = unique_offsets.index(offset)
                if idx_in_unique + 1 < len(unique_offsets):
                    size = unique_offsets[idx_in_unique + 1] - offset
                else:
                    size = 512  # default: 256 colors * 2 bytes
                size = min(size, 512)

                pal_data = rom[offset:offset + size]
                num_colors = size // 2
                palette = parse_palette(rom, offset, num_colors)

                name = f"palette_{i:02d}"
                bin_path = os.path.join(OUT_DIR, "palettes", f"{name}.bin")
                png_path = os.path.join(OUT_DIR, "palettes", f"{name}.png")

                # Save raw binary
                os.makedirs(os.path.dirname(bin_path), exist_ok=True)
                with open(bin_path, 'wb') as f:
                    f.write(pal_data)

                # Render palette swatch
                swatch_w = min(num_colors, 16) * 16
                swatch_h = math.ceil(num_colors / 16) * 16
                img = Image.new('RGB', (swatch_w, swatch_h), (0, 0, 0))
                pixels = img.load()
                for ci, color in enumerate(palette):
                    cx = (ci % 16) * 16
                    cy = (ci // 16) * 16
                    for dy in range(16):
                        for dx in range(16):
                            if cx + dx < swatch_w and cy + dy < swatch_h:
                                pixels[cx + dx, cy + dy] = color
                img.save(png_path)

                asset_info["type"] = "palette"
                asset_info["num_colors"] = num_colors
                asset_info["size"] = size
                asset_info["bin"] = bin_path
                asset_info["png"] = png_path
                print(f"  GFX[{i:2d}] palette ({num_colors} colors) -> {png_path}")
            else:
                # Raw tile data or empty
                print(f"  GFX[{i:2d}] raw/empty at 0x{offset:06X}")
                asset_info["type"] = "raw_tiles"

            manifest["assets"].append(asset_info)
            continue

        # Compressed asset - extract blob and decompress
        asset_info["compression"] = "huffman+lz77" if is_huffman else "lz77"
        asset_info["decomp_size"] = decomp_size

        try:
            result, _, _ = decompress_asset(rom, offset)
        except Exception as e:
            print(f"  GFX[{i:2d}] FAILED: {e}")
            asset_info["error"] = str(e)
            manifest["assets"].append(asset_info)
            continue

        # Determine compressed blob size by finding next unique offset
        idx_in_unique = unique_offsets.index(offset)
        if idx_in_unique + 1 < len(unique_offsets):
            comp_size = unique_offsets[idx_in_unique + 1] - offset
        else:
            comp_size = len(rom) - offset

        # Save compressed binary
        name = f"gfx_{i:02d}"
        subdir = "backgrounds"
        bin_path = os.path.join(OUT_DIR, subdir, f"{name}.bin")
        png_path = os.path.join(OUT_DIR, subdir, f"{name}.png")

        os.makedirs(os.path.dirname(bin_path), exist_ok=True)
        with open(bin_path, 'wb') as f:
            f.write(rom[offset:offset + comp_size])

        # Skip 4-byte asset header (metadata skipped by game's DMA copy)
        tile_data = result[4:]

        # Render as 4bpp tile sheet (16 tiles wide = 128px, matches GBA charblock layout)
        img = render_4bpp_tiles(tile_data, GRAYSCALE_4BPP, tiles_per_row=16)
        if img:
            img.save(png_path)

        asset_info["comp_size"] = comp_size
        asset_info["bin"] = bin_path
        asset_info["png"] = png_path if img else None
        manifest["assets"].append(asset_info)
        print(f"  GFX[{i:2d}] {decomp_size:6d} bytes ({asset_info['compression']}) -> {png_path}")


def extract_tileset_data(rom, manifest):
    """Extract assets from ROM_TILESET_TABLE.

    Each entry points to a sub-array of {count, ptr} pairs describing
    tileset animation frames/layers.
    """
    print("\n=== Extracting Tileset Data ===")

    # Read table entries
    entries = []
    pos = ROM_TILESET_TABLE
    while True:
        val = struct.unpack_from('<I', rom, pos)[0]
        if val < 0x08000000 or val > 0x08400000:
            break
        entries.append(val - 0x08000000)
        pos += 4

    print(f"Found {len(entries)} tileset entries")

    # For each tileset entry, use entry boundaries to limit sub-array size
    for i, offset in enumerate(entries):
        # Boundary: next entry or reasonable max
        if i + 1 < len(entries):
            max_bytes = entries[i + 1] - offset
        else:
            max_bytes = 2048
        max_sub = min(max_bytes // 8, 256)

        sub_pos = offset
        sub_entries = []
        for j in range(max_sub):
            count = struct.unpack_from('<I', rom, sub_pos)[0]
            ptr = struct.unpack_from('<I', rom, sub_pos + 4)[0]
            if count > 100 or ptr < 0x08000000 or ptr > 0x08400000:
                break
            sub_entries.append((count, ptr - 0x08000000))
            sub_pos += 8

        if i < 5 or i % 30 == 0:
            print(f"  Tileset[{i:3d}] at 0x{offset:06X}: {len(sub_entries)} sub-entries")

        asset_info = {
            "table": "TILESET_TABLE",
            "index": i,
            "rom_offset": f"0x{offset:06X}",
            "sub_entries": len(sub_entries),
        }
        manifest["assets"].append(asset_info)

    print(f"  ... ({len(entries)} total tilesets)")


def extract_sprite_frames(rom, manifest):
    """Extract assets from ROM_SPRITE_FRAME_TABLE.

    Each entry is {count, ptr} where ptr points to sprite frame metadata.
    """
    print("\n=== Extracting Sprite Frame Data ===")

    entries = []
    pos = ROM_SPRITE_FRAME_TABLE
    for i in range(500):
        count = struct.unpack_from('<I', rom, pos)[0]
        ptr = struct.unpack_from('<I', rom, pos + 4)[0]
        if count > 1000 or (count == 0 and ptr == 0):
            break
        entries.append((count, ptr - 0x08000000 if ptr >= 0x08000000 else ptr))
        pos += 8

    print(f"Found {len(entries)} sprite frame entries")

    asset_info = {
        "table": "SPRITE_FRAME_TABLE",
        "total_entries": len(entries),
        "note": "Sprite frame metadata (OAM attributes, not raw tile data)",
    }
    manifest["assets"].append(asset_info)


def main():
    rom_path = sys.argv[1] if len(sys.argv) > 1 else ROM_PATH

    if not os.path.exists(rom_path):
        print(f"ERROR: ROM not found at {rom_path}")
        sys.exit(1)

    with open(rom_path, 'rb') as f:
        rom = f.read()

    print(f"ROM: {rom_path} ({len(rom)} bytes)")
    os.makedirs(OUT_DIR, exist_ok=True)

    manifest = {
        "rom": rom_path,
        "rom_size": len(rom),
        "assets": [],
    }

    extract_gfx_assets(rom, manifest)
    extract_tileset_data(rom, manifest)
    extract_sprite_frames(rom, manifest)

    # Write manifest
    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"\nManifest written to {manifest_path}")
    print(f"Total assets catalogued: {len(manifest['assets'])}")


if __name__ == '__main__':
    main()
