# Supabase Edge Function Deployment Guide

## Quick Deploy (Easiest Method)

**Run this single command in your terminal:**

```bash
cd "/Users/nathhui/Documents/mimoai" && ./deploy.sh
```

This script will:
1. Login to Supabase (opens browser)
2. Link to your project
3. Deploy the `recover_element` function
4. Set the `GEMINI_API_KEY` secret

## Manual Deploy (Step by Step)

If you prefer to run commands manually:

1. **Login to Supabase CLI:**
   ```bash
   npx supabase login
   ```
   This will open a browser window for authentication.

2. **Link to your project:**
   ```bash
   cd "/Users/nathhui/Documents/mimoai"
   npx supabase link --project-ref jfboagngbpzollcipewh
   ```

3. **Deploy the Edge Function:**
   ```bash
   npx supabase functions deploy recover_element
   ```

4. **Set the Gemini API Key secret:**
   ```bash
   # Get your API key from https://aistudio.google.com/app/apikey
   npx supabase secrets set GEMINI_API_KEY=YOUR_ACTUAL_API_KEY_HERE
   ```
   
   **⚠️ Security Note:** Never commit API keys to git. Always use Supabase secrets for production.

## Verify Deployment

After deployment, you can test the function:

```bash
curl -X POST https://jfboagngbpzollcipewh.supabase.co/functions/v1/recover_element \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":{"type":"CLICK","url":"https://example.com"},"pageContext":{"title":"Test","url":"https://example.com"}}'
```

## Project Details

- **Project ID**: jfboagngbpzollcipewh
- **Project URL**: https://jfboagngbpzollcipewh.supabase.co
- **Anon Key**: Already configured in `src/lib/ai-config.ts`
- **Edge Function**: `recover_element`
- **Database**: `ai_cache` table already created ✅

## Troubleshooting

If deployment fails:
1. Make sure you're logged in: `npx supabase login`
2. Check project access: `npx supabase projects list`
3. Verify function code is in: `supabase/functions/recover_element/index.ts`
