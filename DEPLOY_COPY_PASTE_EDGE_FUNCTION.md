# Deploy Copy/Paste Edge Function

## Issue

Copy/paste keyboard shortcuts are being recorded correctly, but the AI descriptions are generic ("Press c" instead of "Copy Wok and Roast text") because the Edge Function code hasn't been deployed yet.

## Evidence

- ✅ Clipboard data is captured: `📋 GhostWriter Copy Detected: Wok and Roast`
- ✅ Metadata is added: `📋 GhostWriter: Copy keyboard shortcut detected, adding clipboard metadata`
- ✅ Cache is skipped: `GhostWriter: Skipping cache for copy/paste operation`
- ❌ AI generates generic: `"Press c"` (should be "Copy Wok and Roast text")

## Solution

Deploy the updated Edge Function:

```bash
cd /Users/nathhui/Mimoai

# Deploy the generate_step_description function
npx supabase functions deploy generate_step_description
```

Or if you have a deploy script:
```bash
./deploy-edge-function.sh
```

## After Deployment

1. **Clear AI cache**:
   - Open console (F12)
   - Run: `window.clearAICache()`

2. **Test again**:
   - Start recording
   - Copy text (Cmd+C): "Wok and Roast"
   - Paste text (Cmd+V)
   - Stop recording

3. **Expected results**:
   - Copy step: "Copy restaurant name" or "Copy text: Wok and Roast"
   - Paste step: "Paste copied text into field"

## Why This Happens

TypeScript changes to files in `supabase/functions/` don't automatically deploy. The Edge Functions run on Supabase's servers, so you need to explicitly deploy them after making changes.

**Local changes only affect:**
- `src/` files → Compiled to `dist/` by `npm run build`

**Remote changes require deployment:**
- `supabase/functions/` → Must be deployed to Supabase

## Verify Deployment

After deploying, you can check the Supabase dashboard:
- Go to Edge Functions section
- Check the deployment timestamp
- Look for the latest version

Or check the logs after testing:
```bash
npx supabase functions logs generate_step_description --tail
```

You should see logs showing the copy/paste detection in the Edge Function.

