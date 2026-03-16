.syntax unified
.text

@ Data section — tables, tilesets, sprites, palettes, etc.
	.incbin "baserom.gba", 0x52000, 0x32DF0C - 0x52000

@ Compressed tile sheets (Huffman + LZ77)
@ Indexed by ROM_GFX_ASSET_TABLE at 0x0818B7AC
@ Index formula: (worldID >> 3) * 6 - 1 + visionID

@ World Map select screen tiles (worldID=0, visionID 1-5)
gfx_world_map_1: @ Bell Hill / Breezegale
	.incbin "baserom.gba", 0x32DF0C, 0x32ECF0 - 0x32DF0C
gfx_world_map_2: @ Jugpot
	.incbin "baserom.gba", 0x32ECF0, 0x32F6E8 - 0x32ECF0
gfx_world_map_3: @ Forlock
	.incbin "baserom.gba", 0x32F6E8, 0x33018C - 0x32F6E8
gfx_world_map_4: @ Volk
	.incbin "baserom.gba", 0x33018C, 0x330FC4 - 0x33018C
gfx_world_map_5: @ Ishras Viel
	.incbin "baserom.gba", 0x330FC4, 0x331E48 - 0x330FC4
@ Index 5 is a duplicate of index 0 (same ROM offset 0x32DF0C)

@ EX bonus level tiles (worldID=8, visionID 1-6)
gfx_ex_vision_1:
	.incbin "baserom.gba", 0x331E48, 0x33A734 - 0x331E48
gfx_ex_vision_2:
	.incbin "baserom.gba", 0x33A734, 0x341DF8 - 0x33A734
gfx_ex_vision_3:
	.incbin "baserom.gba", 0x341DF8, 0x3452A4 - 0x341DF8
gfx_ex_vision_4:
	.incbin "baserom.gba", 0x3452A4, 0x34D190 - 0x3452A4
gfx_ex_vision_5:
	.incbin "baserom.gba", 0x34D190, 0x354B2C - 0x34D190
gfx_ex_vision_6:
	.incbin "baserom.gba", 0x354B2C, 0x367604 - 0x354B2C

@ Zero padding to fill ROM to 4MB
	.fill 0x400000 - 0x367604, 1, 0
