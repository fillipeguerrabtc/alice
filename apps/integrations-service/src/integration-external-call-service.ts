type ObserveIntegrationCallParams<T> = {
  integration: string;
  operation: string;
  fn: () => Promise<T>;
};

type ObserveIntegrationCall = <T>(params: ObserveIntegrationCallParams<T>) => Promise<T>;

export function createExecuteStripeCall(observeIntegrationCall: ObserveIntegrationCall) {
  return async function executeStripeCall<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    return observeIntegrationCall({
      integration: 'stripe',
      operation,
      fn,
    });
  };
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
