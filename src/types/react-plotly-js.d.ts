declare module 'react-plotly.js/factory' {
  import type { ComponentType } from 'react';
  const createPlotlyComponent: (plotly: unknown) => ComponentType<any>;
  export default createPlotlyComponent;
}

declare module 'plotly.js-cartesian-dist-min' {
  const Plotly: unknown;
  export default Plotly;
}
