#!/bin/bash

# F1 Analysis Dashboard - Run Script
echo "🚀 Starting F1 Analysis Dashboard..."

# Check if we're in production (Railway, Render, etc.) or development
if [ "$RAILWAY_ENVIRONMENT" ] || [ "$PRODUCTION" = "true" ] || [ "$NODE_ENV" = "production" ] || [ "$PORT" ]; then
    echo "🏭 Running in PRODUCTION mode"
    echo "Environment variables: RAILWAY_ENVIRONMENT=$RAILWAY_ENVIRONMENT, PORT=$PORT, NODE_ENV=$NODE_ENV"

    # Install Python dependencies if not already installed
    if ! python3 -c "import fastapi" 2>/dev/null; then
        echo "📦 Installing Python dependencies..."
        pip3 install -r requirements.txt
    fi

    # Always build frontend in production
    echo "🔨 Building frontend..."

    # Install dependencies
    echo "📦 Installing Node.js dependencies..."
    if ! npm ci; then
        echo "⚠️ npm ci failed, trying npm install..."
        if ! npm install; then
            echo "❌ Both npm ci and npm install failed!"
            exit 1
        fi
    fi

    # Build the frontend
    echo "🏗️ Running safe build (with type checking)..."
    if npm run build:safe 2>/dev/null; then
        echo "✅ Safe build succeeded!"
    else
        echo "⚠️ Safe build failed, trying regular build..."
        if ! npm run build; then
            echo "❌ Regular build failed! Trying force build..."
            if ! npm run build:force; then
                echo "❌ All builds failed!"
                echo "Checking for detailed errors..."
                echo "TypeScript check:"
                npm run type-check 2>&1 || true
                echo "Node version:"
                node --version
                echo "NPM version:"
                npm --version
                echo "Checking package.json..."
                cat package.json | head -20
                exit 1
            fi
        fi
    fi

    echo "📁 Checking dist directory..."
    if [ -d "dist" ]; then
        echo "✅ dist directory exists"
        ls -la dist/ | head -10
        # Check if index.html exists
        if [ -f "dist/index.html" ]; then
            echo "✅ index.html found in dist/"
        else
            echo "❌ index.html not found in dist/"
            exit 1
        fi
    else
        echo "❌ dist directory not found after build!"
        echo "Checking current directory contents..."
        ls -la
        echo "Checking node_modules..."
        ls -la node_modules/ | head -5
        exit 1
    fi

    # Create FastF1 cache directory
    echo "📁 Creating FastF1 cache directory..."
    mkdir -p ./fastf1_cache

    echo "🌐 Starting production server (FastAPI + Static Files)..."
    python3 main.py
else
    echo "💻 Running in DEVELOPMENT mode"

    # Check if Python is installed
    if ! command -v python3 &> /dev/null; then
        echo "❌ Python 3 is required but not installed. Please install Python 3.8+"
        exit 1
    fi

    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js is required but not installed. Please install Node.js 16+"
        exit 1
    fi

    # Install Python dependencies
    echo "📦 Installing Python dependencies..."
    pip3 install -r requirements.txt

    # Install Node.js dependencies
    echo "📦 Installing Node.js dependencies..."
    npm install

    # Create FastF1 cache directory
    echo "📁 Creating FastF1 cache directory..."
    mkdir -p ./fastf1_cache

    echo "✅ Dependencies installed successfully!"

    # Function to cleanup background processes
    cleanup() {
        echo ""
        echo "🛑 Shutting down servers..."
        kill $(jobs -p) 2>/dev/null
        exit 0
    }

    # Set trap to cleanup on script exit
    trap cleanup SIGINT SIGTERM

    echo ""
    echo "🌐 Starting backend server (FastAPI)..."
    python3 main.py &
    BACKEND_PID=$!

    echo "⏳ Waiting for backend to start..."
    sleep 3

    echo "🌐 Starting frontend server (Vite)..."
    npm run dev &
    FRONTEND_PID=$!

    echo ""
    echo "✅ Both servers are running!"
    echo "📱 Frontend: http://localhost:5173"
    echo "🔌 Backend API: http://localhost:8000"
    echo "📚 API Docs: http://localhost:8000/docs"
    echo ""
    echo "Press Ctrl+C to stop both servers"

    # Wait for both processes
    wait
fi

