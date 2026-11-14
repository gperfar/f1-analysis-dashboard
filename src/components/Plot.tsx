/**
 * Shared Plotly wrapper: dark theme defaults, responsive sizing, and the
 * "download as PNG" button, so every chart looks and behaves the same.
 */
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-cartesian-dist-min';
import { colors, fontFamily } from '../theme';

const PlotlyComponent = createPlotlyComponent(Plotly);

interface PlotProps {
  data: any[];
  layout?: Record<string, any>;
  height?: number;
  /** File name for the PNG download. */
  filename?: string;
  onClick?: (event: any) => void;
}

// A function, not a shared object: Plotly writes into the layout it's given
// (e.g. `type: 'category'`), which would leak between charts.
const axis = () => ({
  gridcolor: colors.grid,
  zerolinecolor: colors.border,
  linecolor: colors.border,
  tickfont: { color: colors.muted, size: 11 },
  title: { font: { color: colors.muted, size: 12 } },
  automargin: true,
});

function mergeAxis(value: any) {
  const base = axis();
  return { ...base, ...value, title: typeof value?.title === 'string' ? { ...base.title, text: value.title } : { ...base.title, ...value?.title } };
}

export default function Plot({ data, layout = {}, height = 380, filename = 'f1-chart', onClick }: PlotProps) {
  // Deep copies, for the same reason as `axis()` above.
  layout = structuredClone(layout);
  data = structuredClone(data);
  const axes = Object.fromEntries(
    Object.entries(layout)
      .filter(([k]) => /^[xy]axis\d*$/.test(k))
      .map(([k, v]) => [k, mergeAxis(v)])
  );
  return (
    <PlotlyComponent
      data={data}
      layout={{
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: fontFamily, color: colors.text, size: 12 },
        margin: { l: 50, r: 16, t: 16, b: 40 },
        hoverlabel: { bgcolor: colors.panelRaised, bordercolor: colors.border, font: { family: fontFamily, color: colors.text } },
        legend: { orientation: 'h', y: -0.18, font: { color: colors.muted } },
        xaxis: axis(),
        yaxis: axis(),
        ...layout,
        ...axes,
        height,
        autosize: true,
      }}
      config={{
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines'],
        toImageButtonOptions: { format: 'png', filename, scale: 2 },
      }}
      useResizeHandler
      style={{ width: '100%', height }} // responsive mode sizes the plot to its container, so the container needs the height
      onClick={onClick}
    />
  );
}
