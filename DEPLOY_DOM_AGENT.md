# Deploy dom_agent Edge Function

## Quick Deploy

Run these commands from the project root:

```bash
cd "/Users/nathhui/Documents/Autoflow chrome extension"

# 1. Login to Supabase (if not already logged in)
supabase login

# 2. Deploy the dom_agent function
supabase functions deploy dom_agent
```

## Full Deployment (All Functions)

If you want to deploy all functions including dom_agent:

```bash
cd "/Users/nathhui/Documents/Autoflow chrome extension"

# Make sure you're logged in
supabase login

# Run the deployment script
./deploy-edge-function.sh
```

## Verify Deployment

After deploying, check that the function is live:

```bash
supabase functions list
```

You should see `dom_agent` in the list.

## Test the Function

After deployment, reload your Chrome extension and try running a workflow with AI Agent mode. The CORS errors should be resolved.

## Troubleshooting

### If you get "Access token not provided":
```bash
supabase login
```

### If you get "Entrypoint path does not exist":
Make sure you're running from the project root, not from the `supabase` directory.

### If CORS errors persist:
1. Check that the function deployed successfully: `supabase functions list`
2. Check the function logs: `supabase functions logs dom_agent`
3. Verify the CORS headers are set in the function code (they are - see line 132-138 in `supabase/functions/dom_agent/index.ts`)



