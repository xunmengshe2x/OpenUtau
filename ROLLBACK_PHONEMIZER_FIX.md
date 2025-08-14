# Rollback Instructions for Thread-Safe Phonemizer Fix

## Quick Rollback
To disable the thread-safe phonemizer fix and return to original behavior, set these environment variables:

```bash
export OPENUTAU_USE_SAFE_PHONEMIZER=false
export OPENUTAU_ENABLE_PARALLEL=false
```

Or in your Modal deployment, update the environment variables to:
```python
env["OPENUTAU_USE_SAFE_PHONEMIZER"] = "false"
env["OPENUTAU_ENABLE_PARALLEL"] = "false"
```

## What Gets Reverted
When the fix is disabled:
- ✅ Uses original `SetSingerOriginal()` method in EnunuOnnxPhonemizer
- ✅ Uses original `ProcessOriginal()` method in EnunuOnnxPhonemizer  
- ✅ Uses original sequential processing in VerseAnalyzerWithBoundaries
- ✅ No thread-safe locks or initialization changes
- ✅ All original code paths remain completely unchanged

## Complete Rollback (if needed)
If you want to completely remove the fixes:

### 1. Revert EnunuOnnxPhonemizer.cs
Remove these sections (marked with `// THREAD-SAFE INITIALIZATION FIX`):
- Lines 53-70: Thread-safe fields and validation method
- Lines 75-117: SetSinger wrapper and SetSingerThreadSafe method
- Lines 201-311: InitializeSingerComponents and PreWarmPhonemizerIfNeeded methods
- Lines 798-860: Process wrapper and ProcessThreadSafe method  
- Lines 863-880: Thread-safe CleanUp method

Keep only the original methods:
- `SetSingerOriginal()` → rename back to `SetSinger()`
- `ProcessOriginal()` → rename back to `Process()`

### 2. Revert VerseAnalyzerWithBoundaries.cs
Remove lines 196-286 (the parallel processing section) and keep only the original sequential loop (lines 250-285).

### 3. Revert modal_deploy.py
Change CPU count back to 1:
```python
cpu=1,  # 1 CPU to prevent parallel processing race conditions
```

Remove the thread-safe environment variables:
```python
env["OMP_NUM_THREADS"] = "1"
env["MKL_NUM_THREADS"] = "1" 
env["OPENBLAS_NUM_THREADS"] = "1"
```

## Testing Rollback
1. Set environment variables to disable fix
2. Run local test: `OPENUTAU_USE_SAFE_PHONEMIZER=false dotnet run --project OpenUtau.Cli -- analyze-verses still_here.ustx`
3. Deploy Modal with fix disabled
4. Test Modal endpoint with curl

## Benefits of This Approach
- ✅ **Zero risk**: Original code is 100% preserved and untouched
- ✅ **Easy toggle**: Single environment variable controls entire fix
- ✅ **Safe testing**: Can switch back instantly if issues occur
- ✅ **Gradual rollout**: Can enable fix for some environments, not others