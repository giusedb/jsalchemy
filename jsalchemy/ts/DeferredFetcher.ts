type BatchFetchFunction<T, K> = (ids: K[]) => Promise<T[]>;

interface PendingRequest<T, K> {
  resolve: (value: T[]) => void;
  reject: (reason?: any) => void;
  ids: K[];
}

/**
 * DeferredFetcher: A generalized class that aggregates requests
 * into a single user-defined batch function.
 */
export default class DeferredFetcher<T, K = string> {
  private queue: PendingRequest<T, K>[] = [];

  constructor(
    private fetcherFn: BatchFetchFunction<T, K>,
    private readonly batchDelay: number = 50,
    private readonly idProp: keyof T = 'id' as keyof T
  ) {
      setInterval(this.processQueue.bind(this), this.batchDelay);
  }

  public async fetch(ids: K[]): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, ids });
    });
  }

  private async processQueue() {
    const currentQueue = [...this.queue];
    this.queue = [];

    if (currentQueue.length === 0) return;

    // Flatten and deduplicate IDs
    const allIds = Array.from(new Set(currentQueue.flatMap(req => req.ids)));

    try {
      // Execute the custom AJAX/Fetch logic passed in the constructor
      const results = await this.fetcherFn(allIds);

      // Map results by ID for efficient lookup
      const resultsMap = new Map(results.map(item => [item[this.idProp], item]));

      // Resolve each requestor with their specific subset
      currentQueue.forEach(req => {
        const requestedData = req.ids
          .map(id => resultsMap.get(id as unknown as T[keyof T]))
          .filter((item): item is T => item !== undefined);
        req.resolve(requestedData);
      });
    } catch (error) {
      currentQueue.forEach(req => req.reject(error));
    }
  }
}

