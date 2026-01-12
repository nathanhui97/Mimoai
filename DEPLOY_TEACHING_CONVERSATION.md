# Deploy Teaching Conversation Edge Function

The teaching conversation feature requires deploying a new Edge Function to Supabase.

## Deployment Command

```bash
# Navigate to the project root
cd /Users/nathhui/Mimoai

# Deploy the teaching_conversation Edge Function
supabase functions deploy teaching_conversation --project-ref jfboagngbpzollcipewh
```

## What This Function Does

The `teaching_conversation` Edge Function handles two modes:

### 1. Pre-Recording Mode
- Input: User's description of what they want to teach ("How to download a dashboard")
- Output: AI's understanding of intent, suggested name, and what to watch for
- Uses Gemini API to parse user intent and identify variables

### 2. Post-Recording Mode
- Input: Teaching intent + recorded workflow steps + previous answers
- Output: Next question OR final learned skill summary
- Generates 1-2 contextual questions to confirm understanding
- Builds the final `LearnedSkill` object with synonyms and example queries

## Environment Variables

Make sure these are set in your Supabase project:

```bash
GEMINI_API_KEY=<your-gemini-api-key>
```

You can set this with:

```bash
supabase secrets set GEMINI_API_KEY=<your-key> --project-ref jfboagngbpzollcipewh
```

## Testing the Deployment

After deployment, test by:

1. **Reload the extension** in Chrome (`chrome://extensions` → reload button)
2. **Open the sidepanel** on any tab
3. **Click "Teach me something new"** button
4. **Type what you want to teach** (e.g., "how to download a report")
5. **Check browser console** for any errors from the Edge Function

If you see errors like:
- `404 Not Found` → Function not deployed
- `500 Internal Server Error` → Check Supabase logs
- `Failed to get next question` → Edge Function may have crashed

## Debugging

View Edge Function logs:

```bash
supabase functions logs teaching_conversation --project-ref jfboagngbpzollcipewh
```

Or in Supabase Dashboard:
https://supabase.com/dashboard/project/jfboagngbpzollcipewh/functions/teaching_conversation/logs

## Changes Made

Fixed the API config issue:
- ✅ Updated `PreRecordingChat.tsx` to use `aiConfig` instead of env vars
- ✅ Updated `PostRecordingChat.tsx` to use `aiConfig` instead of env vars
- ✅ Added better error handling and console logging
- ✅ Build succeeded with no errors

## Current Status

- [x] Edge Function created
- [ ] Edge Function deployed to Supabase
- [ ] GEMINI_API_KEY environment variable set
- [ ] Tested in extension
