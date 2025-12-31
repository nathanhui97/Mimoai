#!/bin/bash

# Script to push your code to GitHub
# Usage: ./push-to-github.sh YOUR_GITHUB_USERNAME REPO_NAME

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: ./push-to-github.sh YOUR_GITHUB_USERNAME REPO_NAME"
    echo "Example: ./push-to-github.sh nathhui autoflow-chrome-extension"
    exit 1
fi

GITHUB_USER=$1
REPO_NAME=$2

echo "Setting up remote and pushing to GitHub..."
git remote add origin https://github.com/${GITHUB_USER}/${REPO_NAME}.git 2>/dev/null || git remote set-url origin https://github.com/${GITHUB_USER}/${REPO_NAME}.git
git branch -M main
git push -u origin main

echo "✅ Done! Your code is now on GitHub at: https://github.com/${GITHUB_USER}/${REPO_NAME}"












