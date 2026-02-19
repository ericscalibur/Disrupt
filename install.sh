#!/bin/bash

# Disrupt Portal Installation Script
# This script helps you set up the Disrupt Portal quickly and easily

set -e  # Exit on any error

echo "🚀 Welcome to Disrupt Portal Setup!"
echo "=================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed."
    echo "Please install Node.js from https://nodejs.org/ and try again."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    echo "❌ Node.js version 14 or higher is required."
    echo "Current version: $(node -v)"
    echo "Please update Node.js from https://nodejs.org/ and try again."
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    echo "Please install npm and try again."
    exit 1
fi

echo "✅ npm $(npm -v) detected"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

echo ""
echo "👤 Creating your Admin account..."
echo "   (.env will be created and JWT secrets generated as part of this step)"
echo ""
node setup.js

echo ""
echo "🎉 Installation Complete!"
echo "========================"
echo ""
echo "📝 Next steps:"
echo "1. Optionally configure email settings for password reset in .env"
echo "2. Run: npm start"
echo "3. Open: http://localhost:3000"
echo ""
echo "🚀 To start the server:"
echo "   npm start"
echo ""
echo "For detailed documentation, see README.md"
