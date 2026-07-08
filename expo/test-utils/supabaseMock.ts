/* eslint-env jest */

/**
 * Shared mock for the Supabase client used by the utils/*Store.ts modules.
 *
 * The stores build chains like
 *   supabase.from("wallets").select(...).eq(...).order(...)
 * and await the chain (or call .single()/.maybeSingle()). This mock records
 * every chain step for assertions and resolves each awaited query with the
 * next result from a FIFO queue (defaulting to `{ data: null, error: null }`).
 *
 * Usage in a test file:
 *
 *   jest.mock("@/utils/supabase", () => ({
 *     isSupabaseConfigured: true,
 *     supabase: null,
 *     uuidv4: () => "…",
 *   }));
 *   const supabaseModule = jest.requireMock("@/utils/supabase");
 *
 *   let sb: SupabaseMock;
 *   beforeEach(() => {
 *     sb = createSupabaseMock();
 *     supabaseModule.supabase = sb.client;
 *   });
 */

export interface MockResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

export interface RecordedStep {
  method: string;
  args: unknown[];
}

export interface RecordedQuery {
  table: string;
  steps: RecordedStep[];
}

export interface RecordedRpc {
  fn: string;
  params: unknown;
}

export interface SupabaseMock {
  /** Drop-in stand-in for the `supabase` client (from/rpc only). */
  client: { from: jest.Mock; rpc: jest.Mock };
  /** Queue the result for the next awaited `.from(...)` query chain. */
  queueResult: (result: MockResult) => void;
  /** Queue the result for the next `.rpc(...)` call. */
  queueRpcResult: (result: MockResult) => void;
  /** Every `.from(...)` chain, in call order, with its recorded steps. */
  queries: RecordedQuery[];
  /** Every `.rpc(...)` call, in call order. */
  rpcCalls: RecordedRpc[];
}

const CHAIN_METHODS = [
  "select",
  "update",
  "insert",
  "upsert",
  "delete",
  "eq",
  "neq",
  "in",
  "is",
  "gte",
  "lte",
  "gt",
  "lt",
  "not",
  "or",
  "filter",
  "order",
  "limit",
] as const;

export function createSupabaseMock(): SupabaseMock {
  const results: MockResult[] = [];
  const rpcResults: MockResult[] = [];
  const queries: RecordedQuery[] = [];
  const rpcCalls: RecordedRpc[] = [];

  const nextResult = (): MockResult =>
    results.length > 0 ? (results.shift() as MockResult) : { data: null, error: null };

  const from = jest.fn((table: string) => {
    const record: RecordedQuery = { table, steps: [] };
    queries.push(record);

    const builder: any = {};
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        record.steps.push({ method, args });
        return builder;
      };
    }
    const terminal = (method: string) => (...args: unknown[]) => {
      record.steps.push({ method, args });
      return Promise.resolve(nextResult());
    };
    builder.single = terminal("single");
    builder.maybeSingle = terminal("maybeSingle");
    // Awaiting the builder itself resolves the queued result.
    builder.then = (
      onFulfilled?: (value: MockResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(nextResult()).then(onFulfilled, onRejected);
    return builder;
  });

  const rpc = jest.fn((fn: string, params?: unknown) => {
    rpcCalls.push({ fn, params });
    return Promise.resolve(
      rpcResults.length > 0 ? (rpcResults.shift() as MockResult) : { data: null, error: null }
    );
  });

  return {
    client: { from, rpc },
    queueResult: (r) => results.push(r),
    queueRpcResult: (r) => rpcResults.push(r),
    queries,
    rpcCalls,
  };
}

/** Find the recorded step for a method within a query, or undefined. */
export function findStep(query: RecordedQuery, method: string): RecordedStep | undefined {
  return query.steps.find((s) => s.method === method);
}
