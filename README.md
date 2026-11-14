# F1 Analysis

The story of every Formula 1 session since 2023, told with data. Built with React, Plotly and the free [OpenF1](https://openf1.org) API, and published on GitHub Pages: there's no backend.

Live site: https://gperfar.github.io/f1-analysis-dashboard/

## What's in it

The home page opens on the most recent session. Every session page starts with headline cards and a written summary, then tells the story in chapters. Click drivers in the sticky bar to highlight them in every chart.

**Races and sprints**

1. **From grid to flag**: where everyone started and finished
2. **The start**: places gained on lap 1, launch times to 100/200 km/h
3. **How it unfolded**: gap to the leader and running order lap by lap, with safety car / VSC / red flag periods shaded and pit stops marked
4. **Strategy**: tyre stints and pit stop times
5. **Race pace**: lap-time distribution on clean laps, and lap-time trend per stint
6. **Head to head**: any two drivers' fastest laps compared (speed, gap, throttle, brake) and a track map coloured by who was faster in each mini-sector
7. **Replay**: car positions on track for any lap
8. **Fastest laps**, and **Championship**: how the standings moved

**Qualifying**: Q1/Q2/Q3 results, gap to pole with the knock-out cuts, sector rankings, best lap vs "ideal lap", session evolution, head to head.

**Practice**: fastest laps, long-run pace, session evolution, head to head.

**Season page**: calendar with each weekend's podium, and the drivers' and constructors' championship over the season.

Every chart has a camera button to download it as a PNG.

## How the data works

All data comes from [OpenF1](https://openf1.org) (free, no account, 2023 onwards) and track layouts from the MultiViewer circuit API.

- **Pre-computed data.** A GitHub Action (`.github/workflows/deploy.yml`) runs `scripts/build-data.ts` every 4 hours and on every push. It turns each finished session into JSON (`{year}/{round}/{CODE}.json` plus `.telemetry.json` for races and qualifying) and publishes it with the site, so pages load instantly. The files accumulate on the `data` branch; each run spends up to 45 minutes and builds the newest sessions first, so back-filling every season from 2023 takes a few runs.
- **Live fallback.** If a session hasn't been pre-computed yet, the page builds the same data in the browser straight from OpenF1. OpenF1 allows 30 requests a minute, so a live session takes a few seconds, and its telemetry charts (one request per driver) about a minute. Responses are cached in the browser.
- **Replay** always loads live: car positions for one lap, in a single request.

### AI-written recaps (optional)

Add an `ANTHROPIC_API_KEY` repository secret (Settings → Secrets and variables → Actions) and the data build will ask Claude (`claude-opus-5-5`) to write a short recap for each race, sprint and qualifying session, using only the computed facts. It then replaces the template summary on the page. Each recap is one short API call, made once per session.

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Locally, pages build their data live from OpenF1 unless you generate it:

```bash
npm run build-data -- --out public/data --years 2026 --budget-minutes 10
```

## Code structure

- `src/lib/openf1.ts`: OpenF1 client (cache, rate limiter, retries, progress events)
- `src/lib/f1data.ts`: season schedule and session loading
- `src/lib/story.ts`: turns a session into a `SessionStory` (and telemetry, and season data)
- `src/lib/narrative.ts`: headline cards and the written summary
- `src/lib/data.ts`: what pages call: pre-computed JSON first, live OpenF1 otherwise
- `src/pages/`: session story and season pages
- `src/charts/`: race, qualifying/practice and telemetry charts
- `scripts/build-data.ts`: the pre-computing script (runs in Node with the same `src/lib` code)

## Deployment

GitHub Pages, from GitHub Actions: in the repository's **Settings → Pages**, **Source** must be **GitHub Actions**. The build uses relative paths and hash URLs (`#/2026/20/R`), so it works under any path.

## Ideas for later

- Cornering analysis: minimum speeds through each corner
- DRS and energy deployment analysis
- Comparing a driver across seasons
- Shareable summary cards as images

## License

This project is for educational and personal use. It's unofficial and not associated with Formula 1. Please respect F1 data usage policies and OpenF1's terms.
