.syntax unified
.text

@ Data section — tables, tilesets, sprites, palettes, etc.
	.incbin "baserom.gba", 0x52000, 0x32DF0C - 0x52000

@ Compressed background tile sheets (Huffman + LZ77)
@ Indexed by ROM_GFX_ASSET_TABLE at 0x0818B7AC
gfx_00: @ Vision 1 — Landscape / Platforms
	.incbin "baserom.gba", 0x32DF0C, 0x32ECF0 - 0x32DF0C
gfx_01: @ Vision 2 — Forest / Plants
	.incbin "baserom.gba", 0x32ECF0, 0x32F6E8 - 0x32ECF0
gfx_02: @ Vision 3 — Ice / Water
	.incbin "baserom.gba", 0x32F6E8, 0x33018C - 0x32F6E8
gfx_03: @ Vision 4 — Buildings / Architecture
	.incbin "baserom.gba", 0x33018C, 0x330FC4 - 0x33018C
gfx_04: @ Vision 5 — Temple / Palace
	.incbin "baserom.gba", 0x330FC4, 0x331E48 - 0x330FC4
@ gfx_05 is a duplicate of gfx_00 (same ROM offset 0x32DF0C)
gfx_06: @ World 2 — Forest World Tiles
	.incbin "baserom.gba", 0x331E48, 0x33A734 - 0x331E48
gfx_07: @ World 2 — Cave / Ruins Tiles
	.incbin "baserom.gba", 0x33A734, 0x341DF8 - 0x33A734
gfx_08: @ World 2 — Snow / Ice World
	.incbin "baserom.gba", 0x341DF8, 0x3452A4 - 0x341DF8
gfx_09: @ World 2 — Fire / Volcano Tiles
	.incbin "baserom.gba", 0x3452A4, 0x34D190 - 0x3452A4
gfx_10: @ World 2 — Sky / Cloud Tiles
	.incbin "baserom.gba", 0x34D190, 0x354B2C - 0x34D190
gfx_11: @ World 2 — Final World Tiles
	.incbin "baserom.gba", 0x354B2C, 0x367604 - 0x354B2C

@ Zero padding to fill ROM to 4MB
	.fill 0x400000 - 0x367604, 1, 0
