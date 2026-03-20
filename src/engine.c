#include "global.h"
#include "globals.h"
#include "include_asm.h"

INCLUDE_ASM("asm/nonmatchings/engine", VBlankHandler_ModeA);
INCLUDE_ASM("asm/nonmatchings/engine", VBlankHandler_ModeB);
INCLUDE_ASM("asm/nonmatchings/engine", VBlankDmaTransfer);
INCLUDE_ASM("asm/nonmatchings/engine", VBlankHandler_OamOnly);
INCLUDE_ASM("asm/nonmatchings/engine", VBlankHandler_OamOnlyAlt);
INCLUDE_ASM("asm/nonmatchings/engine", VBlankHandler_WithWindowScroll);
/**
 * UpdateFadeEffect: applies brightness fade using REG_BLDY.
 *
 * Reads REG_VCOUNT and entity brightness value, computes fade level
 * via FUN_08051a0c, then writes to REG_BLDY if within valid range (<=16).
 */
void UpdateFadeEffect(void) {
    vu8 *vcount_reg = (vu8 *)0x04000006;
    u8 *entity = (u8 *)0x03002920;
    u8 fade = FUN_08051a0c(*vcount_reg, entity[0x08]);

    if (fade <= 16) {
        *(vu16 *)0x04000052 = ((u32)fade << 8) | fade;
    }
}
INCLUDE_ASM("asm/nonmatchings/engine", HBlankScrollUpdate);
INCLUDE_ASM("asm/nonmatchings/engine", UpdateAffineBGParams);
INCLUDE_ASM("asm/nonmatchings/engine", UpdateWindowCircleEffect);
INCLUDE_ASM("asm/nonmatchings/engine", UpdateBGScrollWithWave);
INCLUDE_ASM("asm/nonmatchings/engine", WaitVBlankAndClearMosaic);
INCLUDE_ASM("asm/nonmatchings/engine", AcknowledgeInterrupt);
INCLUDE_ASM("asm/nonmatchings/engine", InitLevelBG); /* InitGraphicsSystem — full GFX init: decompress assets, configure BG/VRAM */
INCLUDE_ASM("asm/nonmatchings/engine", ScrollBGLayer);
INCLUDE_ASM("asm/nonmatchings/engine", ProcessOamSpriteLayout);
INCLUDE_ASM("asm/nonmatchings/engine", UpdateCameraScroll);
INCLUDE_ASM("asm/nonmatchings/engine", UpdateCameraScrollPlayer2);
INCLUDE_ASM("asm/nonmatchings/engine", CameraModeSwitchHandler);
INCLUDE_ASM("asm/nonmatchings/engine", InitLevelFromROMTable);
INCLUDE_ASM("asm/nonmatchings/engine", ScrollBGColumnLoad);
INCLUDE_ASM("asm/nonmatchings/engine", InitVideoAndBG);
INCLUDE_ASM("asm/nonmatchings/engine", ComputeRotationMatrix);
INCLUDE_ASM("asm/nonmatchings/engine", ResetVideoRegisters); /* RenderFrame — per-frame rendering dispatch */
/**
 * ClearVideoState: zeroes all 99 OAM shadow entries then calls InitOamEntries.
 */
void ClearVideoState(void) {
    register u32 *oamEntry asm("r0") = (u32 *)gOamBuffer0;
    register s32 entryCount asm("r1") = 0x63;
    register s32 zeroFill asm("r2") = 0;
    do {
        s32 bytesLeft = 0x1C;
        do {
            oamEntry++;
            bytesLeft -= 4;
            *oamEntry = zeroFill;
        } while (bytesLeft != 0);
        entryCount--;
    } while (entryCount != 0);
    InitOamEntries();
}
/**
 * ClearOamBufferExtended: zero OAM shadow buffer entries 1-98.
 */
void ClearOamBufferExtended(void) {
    register u32 *oamEntry asm("r0") = (u32 *)gOamBuffer1;
    register s32 entryCount asm("r1") = 0x62;
    register s32 zeroFill asm("r2") = 0;
    do {
        s32 bytesLeft = 0x1C;
        do {
            oamEntry++;
            bytesLeft -= 4;
            *oamEntry = zeroFill;
        } while (bytesLeft != 0);
        entryCount--;
    } while (entryCount != 0);
}
/**
 * ClearOamEntries6Plus: zero OAM shadow buffer entries 6-91.
 */
void ClearOamEntries6Plus(void) {
    register u32 *oamEntry asm("r0") = (u32 *)gOamBuffer6;
    register s32 entryCount asm("r1") = 0x56;
    register s32 zeroFill asm("r2") = 0;
    do {
        s32 bytesLeft = 0x1C;
        do {
            oamEntry++;
            bytesLeft -= 4;
            *oamEntry = zeroFill;
        } while (bytesLeft != 0);
        entryCount--;
    } while (entryCount != 0);
}
