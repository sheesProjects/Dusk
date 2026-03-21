import type { CountdownWidgetApi } from '../shared/contracts';

declare global {
  interface Window {
    countdownWidget: CountdownWidgetApi;
  }
}

export {};
