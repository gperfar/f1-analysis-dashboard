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
    npm install
    npm run build

    echo "📁 Checking dist directory..."
    if [ -d "dist" ]; then
        echo "✅ dist directory exists"
        ls -la dist/
    else
        echo "❌ dist directory not found!"
        echo "📦 Installing Node.js dependencies and retrying build..."
        npm install
        npm run build
        if [ ! -d "dist" ]; then
            echo "❌ Build still failed!"
            exit 1
        fi
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

