export interface LiveObservationStats {
  completions: number;
  attempts: number;
  accessDenied: boolean;
}

interface LiveObserverOptions {
  fetcher?: typeof fetch;
  logger?: (message: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  admitRetry?: () => void;
  maxNetworkAttempts?: number;
  timeoutMs?: number;
}

export function createLiveFetchObserver(options: LiveObserverOptions = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const logger = options.logger ?? console.log;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const maxNetworkAttempts = options.maxNetworkAttempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const stats: LiveObservationStats = { completions: 0, attempts: 0, accessDenied: false };

  const observedFetch: typeof fetch = async (input, init) => {
    const isCompletion = String(input).endsWith('/chat/completions');
    let response: Response | undefined;
    const attemptsForRequest = isCompletion ? maxNetworkAttempts : 1;

    for (let retry = 0; retry < attemptsForRequest; retry++) {
      if (isCompletion && retry > 0) options.admitRetry?.();
      if (isCompletion) stats.attempts++;
      try {
        response = await fetcher(input, isCompletion
          ? { ...init, signal: AbortSignal.timeout(timeoutMs) }
          : init);
        if (isCompletion && response.status === 429 && retry < attemptsForRequest - 1) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = retryAfter && /^\d+$/.test(retryAfter)
            ? Math.max(65, Math.min(Number(retryAfter), 180))
            : 65;
          await response.body?.cancel();
          logger(`RETRY live provider rate limit: waiting ${seconds} seconds`);
          await sleep(seconds * 1000);
          continue;
        }
        break;
      } catch {
        if (!isCompletion || retry === attemptsForRequest - 1) {
          throw new Error('Live provider could not be reached after bounded network attempts.');
        }
        logger('RETRY live provider transport failure (may spend additional credits)');
      }
    }

    if (!response) throw new Error('Live provider returned no response.');
    if (!isCompletion) return response;

    if (response.status === 401 || response.status === 403) stats.accessDenied = true;
    if (response.status !== 200) {
      logger(`FAIL live provider HTTP ${response.status}`);
      throw new Error(`Live provider returned HTTP ${response.status}.`);
    }

    let body: {
      choices?: { finish_reason?: string; message?: { content?: string } }[];
    };
    try {
      body = await response.clone().json();
    } catch {
      throw new Error('Live provider returned malformed JSON.');
    }
    if (body.choices?.[0]?.finish_reason !== 'stop') {
      logger('FAIL live provider completion was incomplete');
      throw new Error('Live provider completion was incomplete.');
    }
    try {
      JSON.parse(body.choices[0].message?.content ?? '');
    } catch {
      throw new Error('Live provider completion was not valid JSON.');
    }
    stats.completions++;
    return response;
  };

  return { fetch: observedFetch, stats };
}

export async function runObservedLiveCheck(
  name: string,
  run: () => Promise<void>,
  stats: LiveObservationStats,
  failedChecks: string[],
  logger: (message: string) => void = console.log,
): Promise<void> {
  if (stats.accessDenied) {
    failedChecks.push(name);
    logger(`BLOCKED live ${name}: provider denied access; no further request sent`);
    return;
  }
  try {
    await run();
  } catch {
    // Errors may contain model output or synthetic source details. Keep reports
    // limited to the controlled case name and aggregate request counters.
    failedChecks.push(name);
    logger(`FAIL live ${name} (${stats.completions} JSON completions observed, ${stats.attempts} outbound attempts)`);
  }
}
