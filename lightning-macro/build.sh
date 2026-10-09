#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate

echo "Installing/updating dependencies..."
pip install -r requirements.txt

echo "Building standalone application..."
pyinstaller --noconfirm --onedir --windowed \
    --add-data "index.html:." \
    --name "LightningMacro" \
    --osx-bundle-identifier "com.bbolton.lightningmacro" \
    app.py

echo "Signing application bundle..."
codesign --force --deep --sign "Apple Development: BRENT ALAN BOLTON (RPZJS6UL4W)" dist/LightningMacro.app

echo "Deploying to /Applications/LightningMacro.app..."
rm -rf /Applications/LightningMacro.app
cp -R dist/LightningMacro.app /Applications/LightningMacro.app

echo "Build and deployment to /Applications complete!"
