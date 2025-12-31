# API Key Security Guide

## Overview

This project follows security best practices to protect API keys and prevent leaks. All Gemini API calls are made server-side through Supabase Edge Functions, never from client-side code.

## Architecture

**All API calls go through Supabase Edge Functions - API keys are NEVER exposed to client-side code or GitHub.**

```
┌─────────────────┐
│  Chrome Extension│
│  (Client-side)   │
│                  │
│  ✅ NO API KEYS  │
│  ✅ Only calls   │
│     Supabase     │
│     Edge Funcs   │
└────────┬─────────┘
         │
         │ HTTP Request to Supabase
         │ (Bearer token only, NO API keys)
         │
         ▼
┌─────────────────┐
│ Supabase Edge   │
│ Functions        │
│ (Server-side)    │
│                  │
│  ✅ API Key from │
│     Supabase     │
│     Secrets      │
│  ✅ Deno.env.get │
│     ('GEMINI_    │
│     API_KEY')    │
└────────┬─────────┘
         │
         │ API Key from Supabase secrets
         │ (Never exposed to client)
         │
         ▼
┌─────────────────┐
│  Gemini API      │
└─────────────────┘
```

**Key Points:**
- ✅ Client-side code (`src/`) has **ZERO** API keys
- ✅ All Gemini API calls happen in Supabase Edge Functions only
- ✅ API keys stored in Supabase secrets (set via `npx supabase secrets set`)
- ✅ API keys never committed to git (`.gitignore` configured)
- ✅ API keys never exposed in HTTP responses or logs

## Security Rules ✅

### ✅ Never Commit API Keys to Source Control

- All API keys are stored in Supabase secrets, not in code
- `.gitignore` is configured to exclude `.env` files and secrets
- No API keys in any source files

### ✅ Never Expose API Keys on Client-Side

- Client-side code (`src/`) never contains API keys
- All Gemini API calls go through Supabase Edge Functions
- Edge Functions use environment variables (`Deno.env.get('GEMINI_API_KEY')`)

### ✅ Use Server-Side Calls with API Keys

- All 8 Edge Functions use `Deno.env.get('GEMINI_API_KEY')`
- API keys are stored securely in Supabase secrets
- Keys are never exposed in HTTP responses or logs

## Setting Up API Keys

### 1. Get a Gemini API Key

1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the API key (starts with `AIza...`)

### 2. Set Supabase Secret

```bash
npx supabase secrets set GEMINI_API_KEY=YOUR_ACTUAL_API_KEY_HERE
```

### 3. Verify Secret is Set

```bash
npx supabase secrets list
```

You should see `GEMINI_API_KEY` in the list.

### 4. Restrict API Key (Recommended)

In Google Cloud Console:
1. Go to **APIs & Services** > **Credentials**
2. Find your API key
3. Click **Edit**
4. Under **API restrictions**, select **Restrict key**
5. Choose **Generative Language API**
6. Under **Application restrictions**, you can add:
   - IP restrictions (for Supabase Edge Functions)
   - HTTP referrer restrictions (if needed)

## Deployment

### Secure Deployment Script

Use `deploy-edge-function.sh` which:
- ✅ Checks for `GEMINI_API_KEY` environment variable
- ✅ Never hardcodes API keys
- ✅ Provides clear instructions if key is missing

```bash
# Option 1: Set environment variable
export GEMINI_API_KEY=YOUR_API_KEY
./deploy-edge-function.sh

# Option 2: Set manually after deployment
./deploy-edge-function.sh
npx supabase secrets set GEMINI_API_KEY=YOUR_API_KEY
```

### What NOT to Do ❌

- ❌ Don't hardcode API keys in scripts
- ❌ Don't commit API keys to git
- ❌ Don't share API keys in documentation
- ❌ Don't use API keys directly in client-side code
- ❌ Don't log API keys in console or files

## Edge Functions Using API Keys

All these functions securely use `GEMINI_API_KEY` from environment:

1. `recover_element` - Element recovery
2. `validate_selector` - Selector validation
3. `generate_step_description` - Step description generation
4. `detect_variables` - Variable detection
5. `analyze_intent` - Intent analysis
6. `visual_analysis` - Visual analysis
7. `visual_similarity` - Visual similarity matching
8. `classify_page_type` - Page type classification

## Verification Checklist

- [x] No API keys in client-side code (`src/`)
- [x] All Edge Functions use `Deno.env.get('GEMINI_API_KEY')`
- [x] `.gitignore` excludes `.env` files and Supabase temp files
- [x] Deployment scripts don't hardcode keys
- [x] Documentation doesn't contain real API keys
- [x] API keys stored in Supabase secrets only
- [x] All API calls go through Supabase Edge Functions

## Automated Security Verification

Run the security verification script before committing:

```bash
./verify-security.sh
```

This script checks:
- ✅ No hardcoded API keys in source code
- ✅ No direct Gemini API calls from client-side
- ✅ All Edge Functions use environment variables
- ✅ `.gitignore` is properly configured
- ✅ No `.env` files that might be committed

**Always run this before pushing to GitHub!**

## If Your API Key is Leaked

1. **Immediately revoke the key** in Google Cloud Console
2. **Generate a new API key**
3. **Update Supabase secret**:
   ```bash
   npx supabase secrets set GEMINI_API_KEY=NEW_API_KEY
   ```
4. **Review git history** to find where it was committed
5. **Remove from git history** if necessary (use `git filter-branch` or BFG Repo-Cleaner)
6. **Restrict the new key** with API restrictions

## Additional Security Measures

### Rate Limiting
- Supabase Edge Functions have built-in rate limiting
- Consider adding additional rate limiting in Edge Functions if needed

### Monitoring
- Monitor API usage in Google Cloud Console
- Set up alerts for unusual usage patterns
- Review Supabase Edge Function logs regularly

### Key Rotation
- Rotate API keys periodically (e.g., every 90 days)
- Use different keys for development and production if needed

## Questions?

If you have security concerns or questions:
1. Review this guide
2. Check Supabase documentation: https://supabase.com/docs/guides/functions/secrets
3. Review Google Cloud API key security: https://cloud.google.com/docs/authentication/api-keys








