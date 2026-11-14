# F1 Analysis Dashboard

A comprehensive F1 telemetry analysis dashboard built with the OpenF1 API, FastAPI, and React. This application allows you to explore detailed F1 session data through interactive charts and visualizations.

## Features

- **Session Selection**: Choose any race weekend from 2023 onwards and any of its sessions (practice, sprint qualifying, sprint, qualifying, race)
- **Fastest Lap Analysis**: Bar chart showing fastest lap times for each driver, ranked by performance
- **Lap Time Gaps to Pole**: Horizontal bar chart showing time gaps to the pole position lap
- **Start Analysis**: Acceleration analysis showing time to reach 100km/h and 200km/h from the start (race sessions only)
- **Full Throttle Percentage**: Percentage of fastest lap spent at full throttle
- **Tire Strategy**: Visual timeline showing tire compound usage for each driver throughout the session
- **Position Changes**: Line chart showing position changes throughout the session
- **Speed vs Distance**: Speed profiles for each driver's fastest lap
- **Circuit Map**: Interactive track map with numbered corners
- **Interactive Charts**: Built with Plotly.js for smooth, responsive visualizations
- **Modern UI**: Material-UI based dark theme optimized for data analysis

## Prerequisites

- Python 3.10+
- Node.js 16+
- Internet connection (for downloading F1 data)

## Data source

All data comes from [OpenF1](https://openf1.org), a free API with no account
needed. It covers **2023 onwards**.

- OpenF1 allows 30 requests per minute. The backend spaces out its requests
  to stay under that, so the **first** load of a session's telemetry charts
  (speed and full throttle: one request per driver) takes about a minute.
- Every response is cached in `openf1_cache/`, so a finished session only
  downloads once. Delete the folder to start fresh.
- Track layouts and corner numbers come from the MultiViewer circuit API
  (linked from OpenF1).

## Installation & Quick Start

1. **Clone or download the project**

2. **Run the application:**
   ```bash
   ./run.sh
   ```

   This will automatically:
   - Install Python dependencies (FastAPI, requests, numpy)
   - Install Node.js dependencies (React, Plotly, Material-UI, etc.)
   - Start both the backend (FastAPI on port 8000) and frontend (Vite on port 5173) servers

## Manual Setup (Alternative)

If you prefer to set up manually:

1. **Set up Python backend:**
   ```bash
   # Install Python dependencies
   pip install -r requirements.txt
   ```

2. **Set up React frontend:**
   ```bash
   # Install Node.js dependencies
   npm install
   ```

3. **Start the servers:**
   ```bash
   # Terminal 1 - Backend
   python main.py

   # Terminal 2 - Frontend
   npm run dev
   ```

## Deployment

### Quick Deploy with Railway (Recommended - Free & Easy)

1. **Push your code to GitHub:**
   ```bash
   cd /Users/gperfar/Projects/f1-charts
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Create a Railway account** at [railway.app](https://railway.app)

3. **Deploy from GitHub:**
   - Go to Railway dashboard
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will automatically detect Python + Node.js and deploy

4. **Your app will be live!** URL will be something like `https://your-app-name.railway.app`

### Alternative Free Deployment Options

#### Render
- **Pros:** Similar to Railway, good free tier
- **Setup:** Connect GitHub repo, set build/start commands
- **URL:** `https://your-app.onrender.com`

#### Fly.io
- **Pros:** Excellent for full-stack Python apps
- **Setup:** `fly launch` in your project directory
- **Free tier:** 3 shared CPUs, 256MB RAM

#### Vercel + Railway (Split Deployment)
- **Frontend:** Deploy React app to Vercel (free)
- **Backend:** Deploy FastAPI to Railway (free)
- **Pros:** Specialized hosting for each part

### Deployment Checklist

- ✅ GitHub repository created and pushed
- ✅ Railway account created
- ✅ GitHub repo connected to Railway
- ✅ Deployment completed (may take 5-10 minutes)
- ✅ Live URL generated
- ✅ Test your deployed F1 Analysis Dashboard!

### Alternative Free Options

#### Render
1. Create account at [render.com](https://render.com)
2. Connect GitHub repo
3. Set build command: `npm install && npm run build`
4. Set start command: `./run.sh`

#### Fly.io
1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run `fly launch` in your project directory
3. Follow the prompts to deploy

## Usage

1. Open your browser and navigate to `http://localhost:5173`
2. The app defaults to Abu Dhabi 2025 Race session
3. Use the dropdowns to select different years, races, and session types
4. Click the "Go" button to load session data and view charts
5. Explore the interactive charts that appear below

## API Endpoints

The FastAPI backend provides the following endpoints:

`session_type` is one of `fp1`, `fp2`, `fp3`, `sq` (sprint qualifying), `s` (sprint), `q`, `r`.

- `GET /api/schedule/{year}` - Race weekends of a season and their sessions
- `GET /api/session/{year}/{round}/{session_type}` - Session info, weather and drivers
- `GET /api/fastest-laps/{year}/{round}/{session_type}` - Each driver's fastest lap and gap to the best
- `GET /api/lap-deltas/{year}/{round}/{session_type}` - Gaps to the best lap
- `GET /api/tire-strategy/{year}/{round}/{session_type}` - Tyre compound per lap
- `GET /api/position-changes/{year}/{round}/{session_type}` - Position at the end of each lap
- `GET /api/full-throttle/{year}/{round}/{session_type}` - % of the fastest lap above 90% throttle
- `GET /api/speed-distance/{year}/{round}/{session_type}` - Speed trace of each fastest lap
- `GET /api/circuit-map/{year}/{round}/{session_type}` - Track outline with corner numbers
- `GET /api/start-analysis/{year}/{round}` - Launch to 100 and 200 km/h at the race start

## Chart Types

### Fastest Lap Times
- Horizontal bar chart showing lap times in ascending order
- Color-coded by team
- Hover for detailed information

### Start Analysis
- Grouped bar chart comparing acceleration times
- Shows time to reach 100km/h and 200km/h
- Only available for race sessions

### Tire Strategy
- Timeline visualization of tire compound usage
- Color-coded tire compounds (Soft, Medium, Hard, Intermediate, Wet)
- Shows when each driver changed tires during the session

## Data Sources

This application uses [OpenF1](https://openf1.org) (see *Data source* above). Data includes:

- Lap times and sector times
- Car telemetry (speed, throttle, brake, etc.)
- Tire data and pit stop information
- Weather conditions
- Driver and team information

## Development

### Backend Development
- Built with FastAPI for high performance
- Automatic API documentation at `http://localhost:8000/docs`
- CORS enabled for frontend integration

### Frontend Development
- React 18 with TypeScript
- Material-UI for consistent styling
- Plotly.js for interactive charts
- Responsive design for all screen sizes

## Troubleshooting

### Common Issues

1. **No data available**: OpenF1 publishes a session's data shortly after it ends; sessions before 2023 aren't available
2. **Slow loading**: The first load of a session's telemetry takes about a minute because of OpenF1's rate limit; after that it comes from `openf1_cache/`
3. **API errors**: Check that both frontend and backend servers are running

### Data Availability

- Data is available from the 2023 season onwards
- Some sessions may have limited data depending on what was recorded
- Internet connection required for initial data download

## Future Enhancements

The following features could be added in future versions:

- **Cornering Analysis**: Detailed analysis of cornering speeds and apex data
- **Fuel Consumption**: Fuel usage analysis throughout sessions
- **DRS Analysis**: DRS activation and performance impact
- **Head-to-Head Comparisons**: Compare two drivers' performance
- **Historical Trends**: Compare performance across multiple seasons
- **Circuit Maps**: Interactive circuit layouts with telemetry overlays

## License

This project is for educational and personal use. Please respect F1 data usage policies and OpenF1's terms.

## Contributing

Feel free to submit issues, feature requests, or pull requests to improve the application!

