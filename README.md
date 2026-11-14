# F1 Analysis Dashboard

An F1 data analysis dashboard built with React and the [OpenF1](https://openf1.org) API. Explore session data from 2023 onwards through interactive charts.

It runs entirely in the browser: there's no backend. The page calls OpenF1 directly, so it can be hosted as static files (it deploys to GitHub Pages).

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

- Node.js 18+ (see `.nvmrc`)
- Internet connection (data is fetched from OpenF1)

## Data source

All data comes from [OpenF1](https://openf1.org), a free API with no account needed. It covers **2023 onwards**.

- OpenF1 allows 30 requests per minute per IP. The app spaces out its requests to stay under that, so the **first** load of a session's telemetry charts (speed and full throttle: one request per driver) takes about a minute.
- Responses are cached in the browser (Cache API), so a finished session only downloads once per visitor.
- Track layouts and corner numbers come from the MultiViewer circuit API (linked from OpenF1).

## Running locally

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds the app and publishes it to GitHub Pages on every push to `main`.

One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

The site is then served at `https://<user>.github.io/<repo>/`. The build uses relative paths (`base: './'` in `vite.config.ts`), so it works under any path.

## Code structure

- `src/lib/openf1.ts` - OpenF1 client: browser cache, rate limiter, retries
- `src/lib/f1data.ts` - season schedule, sessions, laps, tyres, positions, telemetry, start analysis, circuit layout
- `src/lib/api.ts` - `apiGet('/api/...')`: turns that data into what each chart needs
- `src/components/` - one component per chart (Plotly.js), plus the session selector

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

## Troubleshooting

1. **No data available**: OpenF1 publishes a session's data shortly after it ends; sessions before 2023 aren't available
2. **Slow loading**: The first load of a session's telemetry takes about a minute because of OpenF1's rate limit; after that it comes from the browser cache
3. **Stale or broken data**: clear the site data in your browser to empty the cache

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

