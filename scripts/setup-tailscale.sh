#!/bin/bash
# LoopForge Tailscale Setup
# Enables secure access from anywhere (phone, laptop, coffee shop)

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           LOOPFORGE — TAILSCALE SETUP                        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if Tailscale is installed
if ! command -v tailscale &> /dev/null; then
    echo "📦 Installing Tailscale..."
    
    # Check for Mac App Store version first (preferred)
    if [ -d "/Applications/Tailscale.app" ]; then
        echo "✅ Tailscale.app found"
    else
        echo ""
        echo "⚠️  Tailscale not found. Install one of these:"
        echo ""
        echo "   RECOMMENDED (GUI + Menu Bar):"
        echo "   → Mac App Store: https://apps.apple.com/app/tailscale/id1475387142"
        echo ""
        echo "   OR via Homebrew (CLI only):"
        echo "   → brew install tailscale && brew services start tailscale"
        echo ""
        echo "After installing, run this script again."
        exit 1
    fi
fi

# Check Tailscale status
echo "🔍 Checking Tailscale status..."
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null)

if [ -z "$TAILSCALE_IP" ]; then
    echo ""
    echo "⚠️  Tailscale is not connected."
    echo ""
    echo "   1. Open Tailscale from menu bar (or /Applications/Tailscale.app)"
    echo "   2. Click 'Log in' and authenticate"
    echo "   3. Run this script again"
    echo ""
    
    # Try to open Tailscale app
    if [ -d "/Applications/Tailscale.app" ]; then
        echo "Opening Tailscale.app..."
        open /Applications/Tailscale.app
    fi
    exit 1
fi

echo ""
echo "✅ Tailscale connected!"
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  YOUR LOOPFORGE ACCESS URLS                                   ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                               ║"
echo "║  Local (this Mac):                                            ║"
echo "║    http://loopforge.local:3001                                ║"
echo "║                                                               ║"
echo "║  Tailscale (from anywhere):                                   ║"
printf "║    http://%-15s:3001                              ║\n" "$TAILSCALE_IP"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "📱 To access from your phone:"
echo "   1. Install Tailscale on your phone (iOS/Android)"
echo "   2. Log in with the same account"
echo "   3. Open http://${TAILSCALE_IP}:3001 in your browser"
echo ""
echo "🔒 Connection is end-to-end encrypted. Only YOUR devices can access."
echo ""

# Update config with Tailscale IP
CONFIG_FILE="$(dirname "$0")/../config.sh"
if [ -f "$CONFIG_FILE" ]; then
    # Check if TAILSCALE_IP is already in config
    if grep -q "LOOPFORGE_TAILSCALE_IP" "$CONFIG_FILE"; then
        sed -i '' "s/export LOOPFORGE_TAILSCALE_IP=.*/export LOOPFORGE_TAILSCALE_IP=\"$TAILSCALE_IP\"/" "$CONFIG_FILE"
    else
        echo "export LOOPFORGE_TAILSCALE_IP=\"$TAILSCALE_IP\"" >> "$CONFIG_FILE"
    fi
    echo "✅ Updated config.sh with Tailscale IP"
fi
