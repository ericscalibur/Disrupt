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
echo "🔧 Setting up configuration..."

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
else
    echo "⚠️  .env file already exists, skipping..."
fi

echo ""
echo "🔐 Generating JWT secrets..."

# Generate JWT secrets
ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

# Update .env file with generated secrets
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/ACCESS_TOKEN_SECRET=your-64-character-hex-string-here/ACCESS_TOKEN_SECRET=$ACCESS_SECRET/" .env
    sed -i '' "s/REFRESH_TOKEN_SECRET=your-different-64-character-hex-string-here/REFRESH_TOKEN_SECRET=$REFRESH_SECRET/" .env
else
    # Linux
    sed -i "s/ACCESS_TOKEN_SECRET=your-64-character-hex-string-here/ACCESS_TOKEN_SECRET=$ACCESS_SECRET/" .env
    sed -i "s/REFRESH_TOKEN_SECRET=your-different-64-character-hex-string-here/REFRESH_TOKEN_SECRET=$REFRESH_SECRET/" .env
fi

echo "✅ JWT secrets generated and configured"

echo ""
echo "🎉 Installation Complete!"
echo "========================"
echo ""
echo "📝 Next steps:"
echo "1. Get your Blink API key from https://blink.sv"
echo "2. Edit .env file and add your BLINK_API_KEY"
echo "3. Optionally configure email settings for password reset"
echo "4. Run: npm start"
echo "5. Open: http://localhost:3000"
echo ""
echo "👤 Default login accounts:"
echo "Admin:    ericscalibur@disrupt.com / 9555"
echo "Manager:  quentin@disrupt.com / 1234"
echo "Employee: joe@disrupt.com / 1234"
echo ""
echo "🔧 To configure Blink API:"
echo "   nano .env"
echo "   # Add: BLINK_API_KEY=your-blink-api-key-here"
echo ""
echo "🚀 To start the server:"
echo "   npm start"
echo ""
echo "For detailed documentation, see README.md"
