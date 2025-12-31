#!/bin/bash
# Deployment script for Supabase Edge Function
# Run this after: supabase login

set -e

echo "🚀 Deploying Edge Functions to Supabase..."

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "Installing Supabase CLI via npx..."
    npx supabase --version
fi

# Link to project (if not already linked)
echo "Linking to Supabase project..."
npx supabase link --project-ref jfboagngbpzollcipewh || echo "Already linked or login required"

# Set the Gemini API key secret (needed for all functions)
# SECURITY: API keys are stored in Supabase secrets, never hardcoded in scripts.
# Get your API key from: https://aistudio.google.com/app/apikey
# 
# Option 1: Set as environment variable before running:
#   export GEMINI_API_KEY=YOUR_API_KEY
#   ./deploy-edge-function.sh
#
# Option 2: Set manually after deployment:
#   npx supabase secrets set GEMINI_API_KEY=YOUR_API_KEY
if [ -z "$GEMINI_API_KEY" ]; then
  echo "⚠️  GEMINI_API_KEY environment variable not set."
  echo ""
  echo "   To set it now, run:"
  echo "   npx supabase secrets set GEMINI_API_KEY=YOUR_API_KEY"
  echo ""
  echo "   Or export it before running this script:"
  echo "   export GEMINI_API_KEY=YOUR_API_KEY"
  echo "   ./deploy-edge-function.sh"
  echo ""
  echo "   See SECURITY_GUIDE.md for more information."
else
  echo "Setting GEMINI_API_KEY secret..."
  npx supabase secrets set GEMINI_API_KEY="$GEMINI_API_KEY"
  echo "✅ API key secret set successfully"
fi

# Deploy recover_element function
echo "Deploying recover_element function..."
npx supabase functions deploy recover_element

# Deploy validate_selector function
echo "Deploying validate_selector function..."
npx supabase functions deploy validate_selector

# Deploy generate_step_description function
echo "Deploying generate_step_description function..."
npx supabase functions deploy generate_step_description

# Deploy detect_variables function
echo "Deploying detect_variables function..."
npx supabase functions deploy detect_variables

# Deploy visual_click function (AI Visual Click for 95-99% accuracy)
echo "Deploying visual_click function..."
npx supabase functions deploy visual_click

# Deploy dom_agent function (3-tier agent brain)
echo "Deploying dom_agent function..."
npx supabase functions deploy dom_agent

echo "✅ Deployment complete!"
echo ""
echo "Deployed functions:"
echo "  - recover_element"
echo "  - validate_selector"
echo "  - generate_step_description"
echo "  - detect_variables"
echo "  - visual_click (AI Visual Click)"
echo "  - dom_agent (NEW - 3-tier agent brain)"
echo ""
echo "If deployment fails, make sure you're logged in:"
echo "  npx supabase login"
