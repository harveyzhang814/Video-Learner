#!/bin/bash
# Install dependencies for Video-Learner

set -e

echo "=== Video-Learner Dependencies Installer ==="

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected macOS"

    # Check if Homebrew is installed
    if ! command -v brew &> /dev/null; then
        echo -e "${RED}Homebrew is not installed.${NC}"
        echo "Please install Homebrew first: https://brew.sh"
        exit 1
    fi

    # Check and install dependencies
    echo "Checking dependencies..."

    # yt-dlp
    if command -v yt-dlp &> /dev/null; then
        echo -e "${GREEN}✓${NC} yt-dlp installed: $(yt-dlp --version)"
    else
        echo -e "${YELLOW}Installing yt-dlp...${NC}"
        brew install yt-dlp
    fi

    # ffmpeg
    if command -v ffmpeg &> /dev/null; then
        echo -e "${GREEN}✓${NC} ffmpeg installed: $(ffmpeg -version | head -1)"
    else
        echo -e "${YELLOW}Installing ffmpeg...${NC}"
        brew install ffmpeg
    fi

    # jq
    if command -v jq &> /dev/null; then
        echo -e "${GREEN}✓${NC} jq installed: $(jq --version)"
    else
        echo -e "${YELLOW}Installing jq...${NC}"
        brew install jq
    fi

elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Detected Linux"

    # Check for apt (Debian/Ubuntu)
    if command -v apt-get &> /dev/null; then
        echo "Installing dependencies via apt..."

        if ! command -v yt-dlp &> /dev/null; then
            # yt-dlp needs pip
            if ! command -v pip3 &> /dev/null; then
                sudo apt-get update
                sudo apt-get install -y python3-pip
            fi
            pip3 install yt-dlp
        fi

        if ! command -v ffmpeg &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y ffmpeg
        fi

        if ! command -v jq &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y jq
        fi
    fi
else
    echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
    exit 1
fi

# Install Node.js dependencies
echo ""
echo "Installing Node.js dependencies..."

cd "$PROJECT_DIR/electron"
if [ -f "package.json" ]; then
    npm install
    echo -e "${GREEN}✓${NC} Electron dependencies installed"
else
    echo -e "${YELLOW}Warning: electron/package.json not found${NC}"
fi

# Go back to project root
cd "$PROJECT_DIR"

echo ""
echo -e "${GREEN}=== All dependencies installed successfully! ===${NC}"
echo ""
echo "To start the app, run:"
echo "  bash start-electron.sh"
echo ""
echo "Or start the HTTP agent service (orchestrator API):"
echo "  npm run agent:serve"
echo ""
echo "End-to-end test (slow; needs network + writing engine):"
echo "  npm run test:agent:e2e"
