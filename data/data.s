.syntax unified
.text

@ Data section — tables, tilesets, sprites, palettes, etc.
	.incbin "baserom.gba", 0x52000, 0x367604 - 0x52000

@ Zero padding to fill ROM to 4MB
	.fill 0x400000 - 0x367604, 1, 0
