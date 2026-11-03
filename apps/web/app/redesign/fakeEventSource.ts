/**
 * Test-only stand-in for the browser `EventSource`, used to drive run
 * progress streams (`GET /runs/:runId/events`) in hook and component tests.
 *
 * Install it after `GlobalRegistrator.register()`; every `new EventSource()`
 * the code under test makes is recorded in `FakeEventSource.instances`, and
 * the test pushes server events into it with `open()`, `emit()` and `fail()`.
 * Wrap those calls in `act()` when they update React state.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url);
    this.withCredentials = Boolean(init?.withCredentials);
    FakeEventSource.instances.push(this);
  }

  /** The most recently opened stream, or `undefined` when none was opened. */
  static latest(): FakeEventSource | undefined {
    return FakeEventSource.instances.at(-1);
  }

  static reset() {
    FakeEventSource.instances = [];
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  /** The connection opened. */
  open() {
    this.onopen?.(new Event("open"));
  }

  /** A named SSE event; `data` is serialised as the server would send it. */
  emit(type: string, data: unknown) {
    if (this.closed) return;
    const event = new MessageEvent<string>(type, { data: JSON.stringify(data) });
    if (type === "message") this.onmessage?.(event);
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  /** The connection dropped (the browser would now reconnect). */
  fail() {
    this.onerror?.(new Event("error"));
  }
}

/**
 * Replaces `globalThis.EventSource` with `FakeEventSource` and returns a
 * function that restores the previous value. Call it in `beforeEach`/`afterEach`
 * or `beforeAll`/`afterAll`.
 */
export function installFakeEventSource(): () => void {
  const target = globalThis as { EventSource?: unknown };
  const previous = target.EventSource;
  FakeEventSource.reset();
  target.EventSource = FakeEventSource;
  return () => {
    FakeEventSource.reset();
    target.EventSource = previous;
  };
}
