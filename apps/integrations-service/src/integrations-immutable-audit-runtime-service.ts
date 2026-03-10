import { and, asc, desc, eq, getDatabase, schema } from '@alice/database';

type LoggerLike = {
  info: (obj: Record<string, unknown>, message: string) => void;
  error: (obj: Record<string, unknown>, message: string) => void;
};

type ImmutableAuditIntegrityState = {
  status: 'unknown' | 'ok' | 'error';
  checkedAt: string | null;
  checkedStreams: number;
  brokenStreams: number;
  reason: string | null;
};

type VerifyImmutableAuditChainResult = {
  ok: boolean;
  reason?: string | null;
};

export function createIntegrationsImmutableAuditRuntimeService(deps: {
  logger: LoggerLike;
  immutableAuditCheckIntervalMs: number;
  immutableAuditStreamsPerCheck: number;
  immutableAuditEventsPerStreamLimit: number;
  verifyImmutableAuditChain: (events: Array<{
    chainPosition: number;
    prevEventHash: string | null;
    eventHash: string;
  }>) => VerifyImmutableAuditChainResult;
  immutableAuditIntegrityChecksTotal: {
    inc: (labels: { result: 'ok' | 'error' }) => void;
  };
  immutableAuditIntegrityStatusGauge: {
    set: (value: number) => void;
  };
  immutableAuditIntegrityBrokenStreamsGauge: {
    set: (value: number) => void;
  };
  immutableAuditIntegrityCheckedStreamsGauge: {
    set: (value: number) => void;
  };
  immutableAuditIntegrityLastCheckTimestampSecondsGauge: {
    set: (value: number) => void;
  };
}) {
  let immutableAuditInterval: NodeJS.Timeout | null = null;
  const integrationsImmutableAuditIntegrityState: ImmutableAuditIntegrityState = {
    status: 'unknown',
    checkedAt: null,
    checkedStreams: 0,
    brokenStreams: 0,
    reason: null,
  };

  async function runIntegrationsImmutableAuditIntegrityCheck(): Promise<void> {
    try {
      const db = getDatabase();
      const recentEvents = await db.query.immutableAuditEvents.findMany({
        where: eq(schema.immutableAuditEvents.stream, 'trading_operations'),
        columns: {
          streamKey: true,
        },
        orderBy: [desc(schema.immutableAuditEvents.createdAt)],
        limit: deps.immutableAuditStreamsPerCheck * 50,
      });

      const streamKeys = Array.from(new Set(
        recentEvents
          .map((event) => event.streamKey)
          .filter((streamKey): streamKey is string => typeof streamKey === 'string' && streamKey.length > 0),
      )).slice(0, deps.immutableAuditStreamsPerCheck);

      let brokenStreams = 0;
      let firstReason: string | null = null;

      for (const streamKey of streamKeys) {
        const [latest] = await db.query.immutableAuditEvents.findMany({
          where: and(
            eq(schema.immutableAuditEvents.stream, 'trading_operations'),
            eq(schema.immutableAuditEvents.streamKey, streamKey),
          ),
          columns: {
            chainPosition: true,
          },
          orderBy: [desc(schema.immutableAuditEvents.chainPosition)],
          limit: 1,
        });

        const events = await db.query.immutableAuditEvents.findMany({
          where: and(
            eq(schema.immutableAuditEvents.stream, 'trading_operations'),
            eq(schema.immutableAuditEvents.streamKey, streamKey),
          ),
          columns: {
            chainPosition: true,
            prevEventHash: true,
            eventHash: true,
          },
          orderBy: [asc(schema.immutableAuditEvents.chainPosition)],
          limit: deps.immutableAuditEventsPerStreamLimit,
        });

        const maxChainPosition = Number(latest?.chainPosition ?? 0);
        if (maxChainPosition > events.length) {
          brokenStreams += 1;
          if (!firstReason) {
            firstReason = `${streamKey}:CHAIN_SAMPLE_TRUNCATED max=${maxChainPosition} sampled=${events.length}`;
          }
          continue;
        }

        const chainEvents = events.filter((event): event is {
          chainPosition: number;
          prevEventHash: string | null;
          eventHash: string;
        } => typeof event.eventHash === 'string' && event.eventHash.length > 0);

        if (chainEvents.length !== events.length) {
          brokenStreams += 1;
          if (!firstReason) {
            firstReason = `${streamKey}:MISSING_EVENT_HASH`;
          }
          continue;
        }

        const integrity = deps.verifyImmutableAuditChain(chainEvents);
        if (!integrity.ok) {
          brokenStreams += 1;
          if (!firstReason) {
            firstReason = `${streamKey}:${integrity.reason ?? 'INTEGRITY_CHECK_FAILED'}`;
          }
        }
      }

      const status: ImmutableAuditIntegrityState['status'] = brokenStreams > 0 ? 'error' : 'ok';
      const checkedAt = new Date().toISOString();
      Object.assign(integrationsImmutableAuditIntegrityState, {
        status,
        checkedAt,
        checkedStreams: streamKeys.length,
        brokenStreams,
        reason: firstReason,
      });

      deps.immutableAuditIntegrityChecksTotal.inc({ result: status });
      deps.immutableAuditIntegrityStatusGauge.set(status === 'ok' ? 1 : 0);
      deps.immutableAuditIntegrityBrokenStreamsGauge.set(brokenStreams);
      deps.immutableAuditIntegrityCheckedStreamsGauge.set(streamKeys.length);
      deps.immutableAuditIntegrityLastCheckTimestampSecondsGauge.set(Math.floor(Date.now() / 1000));

      if (status === 'error') {
        deps.logger.error(
          { checkedStreams: streamKeys.length, brokenStreams, reason: firstReason },
          'Verificacao de integridade do ledger imutavel (integrations) falhou',
        );
      }
    } catch (error) {
      Object.assign(integrationsImmutableAuditIntegrityState, {
        status: 'error',
        checkedAt: new Date().toISOString(),
        checkedStreams: 0,
        brokenStreams: 0,
        reason: error instanceof Error ? error.message : String(error),
      });
      deps.immutableAuditIntegrityChecksTotal.inc({ result: 'error' });
      deps.immutableAuditIntegrityStatusGauge.set(0);
      deps.immutableAuditIntegrityBrokenStreamsGauge.set(0);
      deps.immutableAuditIntegrityCheckedStreamsGauge.set(0);
      deps.immutableAuditIntegrityLastCheckTimestampSecondsGauge.set(Math.floor(Date.now() / 1000));
      deps.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Falha ao executar verificacao de integridade do ledger imutavel (integrations)',
      );
    }
  }

  function startIntegrationsImmutableAuditIntegrityScheduler(): void {
    void runIntegrationsImmutableAuditIntegrityCheck();
    immutableAuditInterval = setInterval(() => {
      void runIntegrationsImmutableAuditIntegrityCheck();
    }, deps.immutableAuditCheckIntervalMs);
    deps.logger.info(
      { intervalMs: deps.immutableAuditCheckIntervalMs },
      'Scheduler de verificacao de integridade do ledger imutavel iniciado (integrations)',
    );
  }

  function stopIntegrationsImmutableAuditIntegrityScheduler(): void {
    if (immutableAuditInterval) {
      clearInterval(immutableAuditInterval);
      immutableAuditInterval = null;
    }
  }

  return {
    integrationsImmutableAuditIntegrityState,
    runIntegrationsImmutableAuditIntegrityCheck,
    startIntegrationsImmutableAuditIntegrityScheduler,
    stopIntegrationsImmutableAuditIntegrityScheduler,
  };
}
