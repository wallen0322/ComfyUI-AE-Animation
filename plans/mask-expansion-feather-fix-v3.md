# Mask Expansion and Feather Logic Fix - Version 3

## Problem Analysis

### Issue 1: Feather Logic Completely Broken
Current feathering code (lines 749-765 in useCanvasRenderer.ts):
```javascript
if (feather > 0) {
  expandedMaskCtx.filter = `blur(${feather}px)`
  const imageData = expandedMaskCtx.getImageData(0, 0, width, height)
  // ... complex tempCanvas operations
}
```

**Problems:**
1. Setting `filter` then immediately calling `getImageData` - filter may not be applied yet
2. Recursive drawing in tempCanvas - `drawImage(tempCanvas, 0, 0, width, height)` causes issues
3. Feathering effect is never correctly applied

### Issue 2: Expansion = 0 Behavior Wrong
When `expansion === 0`:
1. Still creates `expandedMaskCanvas` (identical to original)
2. Still creates `edgeMaskCanvas`
3. `expanded - original = 0`, edgeMask becomes fully transparent
4. But edgeMask is still drawn as white border (though transparent)

### Issue 3: Expansion Blur Method Incorrect
Using `blur` for dilation/erosion approximation is unreliable, especially with multiple iterations.

## Fix Plan

### 1. Fix applyMaskExpansion Function

**When expansion === 0 AND feather === 0:**
- Return early with original mask
- No edge mask needed

**When expansion === 0 AND feather > 0:**
- Apply feathering to original mask
- Return feathered mask (no edge mask needed)

**When expansion > 0:**
- Apply expansion (dilation)
- Apply feathering if needed
- Create edge mask (expanded - original)
- Return expanded mask + edge mask

**When expansion < 0:**
- Apply contraction (erosion)
- Apply feathering if needed
- No edge mask (no white border for contraction)
- Return contracted mask

### 2. Simplify Feathering Logic

Instead of complex tempCanvas operations:
```javascript
if (feather > 0) {
  expandedMaskCtx.filter = `blur(${feather}px)`
  expandedMaskCtx.drawImage(expandedMaskCanvas, 0, 0, width, height)
  expandedMaskCtx.filter = 'none'
}
```

### 3. Fix Expansion Logic

Use proper dilation/erosion:
- For dilation: Use `filter = 'blur()'` then threshold
- For erosion: Use `filter = 'contrast()'` or proper morphological operations

## Files to Modify

1. `frontend/src/composables/useCanvasRenderer.ts` - Fix `applyMaskExpansion` function
2. Test feathering with different values (0, 1, 5, 10, 20)
3. Test expansion with different values (-10, 0, 5, 10, 20)
