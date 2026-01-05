#!/bin/bash
# Quick deployment script for Supabase Edge Function
# Run this in your terminal (not via automation)
#
# SECURITY: API keys are stored in Supabase secrets, not in this script.
# Set GEMINI_API_KEY as an environment variable before running, or set it manually:
#   npx supabase secrets set GEMINI_API_KEY=YOUR_API_KEY

set -e

PROJECT_REF="jfboagngbpzollcipewh"

echo "🚀 Deploying recover_element Edge Function to Supabase..."
echo ""
echo "Project: mimoai (${PROJECT_REF})"
echo ""

# Step 1: Login
echo "Step 1: Logging in to Supabase..."
echo "This will open a browser window for authentication."
npx supabase login

# Step 2: Link project
echo ""
echo "Step 2: Linking to project..."
npx supabase link --project-ref ${PROJECT_REF}

# Step 3: Deploy function
echo ""
echo "Step 3: Deploying recover_element function..."
npx supabase functions deploy recover_element

# Step 4: Set secret (if provided as environment variable)
echo ""
if [ -z "$GEMINI_API_KEY" ]; then
  echo "⚠️  GEMINI_API_KEY environment variable not set."
  echo "   Set it manually with: npx supabase secrets set GEMINI_API_KEY=YOUR_API_KEY"
  echo "   Or export it before running this script: export GEMINI_API_KEY=YOUR_API_KEY"
else
  echo "Step 4: Setting GEMINI_API_KEY secret..."
  npx supabase secrets set GEMINI_API_KEY="${GEMINI_API_KEY}"
  echo "✅ API key secret set successfully"
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "The Edge Function is now available at:"
echo "https://jfboagngbpzollcipewh.supabase.co/functions/v1/recover_element"
echo ""
echo "You can test it by running a workflow that triggers AI recovery."
