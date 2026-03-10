export type KucoinWsState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type KucoinWsClientLike = {
  getState(): KucoinWsState;
  on(event: 'stateChange', cb: (s: KucoinWsState) => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
};

type KucoinWsStateGauge = {
  set(labels: { channel: 'public' | 'private' }, value: number): void;
};

type KucoinWsReconnectCounter = {
  inc(labels: { channel: 'public' | 'private' }, value?: number): void;
};

type KucoinWsErrorCounter = {
  inc(labels: { channel: 'public' | 'private' }, value?: number): void;
};

type CreateKucoinWsMetricsWiringParams = {
  kucoinWsStateGauge: KucoinWsStateGauge;
  kucoinWsConnectedGauge: KucoinWsStateGauge;
  kucoinWsReconnectsTotal: KucoinWsReconnectCounter;
  kucoinWsErrorsTotal: KucoinWsErrorCounter;
};

function mapKucoinWsStateToNumber(state: KucoinWsState): number {
  switch (state) {
    case 'disconnected':
      return 0;
    case 'connecting':
      return 0.25;
    case 'reconnecting':
      return 0.5;
    case 'connected':
      return 1;
    default:
      return 0;
  }
}

export function createKucoinWsMetricsWiring(params: CreateKucoinWsMetricsWiringParams) {
  const {
    kucoinWsStateGauge,
    kucoinWsConnectedGauge,
    kucoinWsReconnectsTotal,
    kucoinWsErrorsTotal,
  } = params;

  let kucoinWsMetricsWired = false;

  return function wireKucoinWebSocketMetrics(opts: {
    publicWs: KucoinWsClientLike;
    privateWs?: KucoinWsClientLike | null;
    privateEnabled: boolean;
  }): void {
    if (kucoinWsMetricsWired) return;
    kucoinWsMetricsWired = true;

    const apply = (channel: 'public' | 'private', state: KucoinWsState) => {
      kucoinWsStateGauge.set({ channel }, mapKucoinWsStateToNumber(state));
      kucoinWsConnectedGauge.set({ channel }, state === 'connected' ? 1 : 0);
      if (state === 'reconnecting') {
        kucoinWsReconnectsTotal.inc({ channel }, 1);
      }
    };

    apply('public', opts.publicWs.getState());
    opts.publicWs.on('stateChange', (s) => apply('public', s));
    opts.publicWs.on('error', () => kucoinWsErrorsTotal.inc({ channel: 'public' }, 1));

    if (opts.privateEnabled && opts.privateWs) {
      apply('private', opts.privateWs.getState());
      opts.privateWs.on('stateChange', (s) => apply('private', s));
      opts.privateWs.on('error', () => kucoinWsErrorsTotal.inc({ channel: 'private' }, 1));
    } else {
      kucoinWsStateGauge.set({ channel: 'private' }, 0);
      kucoinWsConnectedGauge.set({ channel: 'private' }, 0);
    }
  };
}
