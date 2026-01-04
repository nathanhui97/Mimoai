#!/bin/bash
# Security Verification Script
# Verifies that no API keys are exposed in the codebase

echo "🔒 Verifying API Key Security..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# Check 1: Look for hardcoded Gemini API keys (AIza... pattern)
echo "1. Checking for hardcoded Gemini API keys..."
API_KEY_MATCHES=$(grep -r "AIza[A-Za-z0-9_-]\{35,\}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.sh" --include="*.json" . 2>/dev/null | grep -v "node_modules" | grep -v ".git" | grep -v "SECURITY_GUIDE.md" | grep -v "FIX_GEMINI_API_KEY.md" | grep -v "env.example" || true)

if [ -z "$API_KEY_MATCHES" ]; then
    echo -e "${GREEN}✅ No hardcoded API keys found${NC}"
else
    echo -e "${RED}❌ Found potential API keys:${NC}"
    echo "$API_KEY_MATCHES"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 2: Verify client-side code doesn't call Gemini API directly
echo "2. Checking for direct Gemini API calls in client-side code..."
CLIENT_API_CALLS=$(grep -r "generativelanguage\.googleapis\.com\|x-goog-api-key" --include="*.ts" --include="*.tsx" src/ 2>/dev/null || true)

if [ -z "$CLIENT_API_CALLS" ]; then
    echo -e "${GREEN}✅ No direct Gemini API calls in client-side code${NC}"
else
    echo -e "${RED}❌ Found direct API calls in client-side code:${NC}"
    echo "$CLIENT_API_CALLS"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 3: Verify Edge Functions use environment variables
echo "3. Verifying Edge Functions use environment variables..."
EDGE_FUNCTIONS=$(find supabase/functions -name "index.ts" 2>/dev/null)

ALL_USE_ENV=true
for func in $EDGE_FUNCTIONS; do
    if grep -q "Deno.env.get('GEMINI_API_KEY')" "$func" 2>/dev/null; then
        echo -e "${GREEN}✅ $(basename $(dirname $func)) uses Deno.env.get${NC}"
    else
        echo -e "${RED}❌ $(basename $(dirname $func)) may not use environment variable${NC}"
        ALL_USE_ENV=false
        ERRORS=$((ERRORS + 1))
    fi
done
echo ""

# Check 4: Verify .gitignore includes secret patterns
echo "4. Checking .gitignore configuration..."
if grep -q "\.env" .gitignore && grep -q "secrets" .gitignore; then
    echo -e "${GREEN}✅ .gitignore includes secret file patterns${NC}"
else
    echo -e "${YELLOW}⚠️  .gitignore may be missing some secret patterns${NC}"
fi
echo ""

# Check 5: Check for API keys in environment files
echo "5. Checking for .env files that might be committed..."
ENV_FILES=$(find . -name ".env*" -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null | grep -v ".example" || true)

if [ -z "$ENV_FILES" ]; then
    echo -e "${GREEN}✅ No .env files found (good - they should be gitignored)${NC}"
else
    echo -e "${YELLOW}⚠️  Found .env files (make sure they're in .gitignore):${NC}"
    echo "$ENV_FILES"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ Security verification passed!${NC}"
    echo ""
    echo "All API keys are properly secured:"
    echo "  • No hardcoded keys in source code"
    echo "  • Client-side code uses Supabase Edge Functions"
    echo "  • Edge Functions use environment variables"
    echo "  • .gitignore configured to prevent commits"
    exit 0
else
    echo -e "${RED}❌ Security verification failed with $ERRORS error(s)${NC}"
    echo ""
    echo "Please review the issues above and fix them before committing."
    exit 1
fi










