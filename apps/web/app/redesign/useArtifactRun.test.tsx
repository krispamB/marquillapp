import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ArtifactType } from "./artifactTypes";
import { API_BASE } from "./api";
import { FakeEventSource, installFakeEventSource } from "./fakeEventSource";
import { useArtifactRun, type InlineArtifactResult } from "./useArtifactRun";

GlobalRegistrator.register();
let restoreEventSource: () => void = () => {};
beforeAll(() => { restoreEventSource = installFakeEventSource(); });
beforeEach(() => FakeEventSource.reset());
afterEach(cleanup);
afterAll(() => {
  restoreEventSource();
  GlobalRegistrator.unregister();
});

type Options = Parameters<typeof useArtifactRun>[0];

/** Renders `useArtifactRun` with recording callbacks; override any option. */
function renderArtifactRun(overrides: Partial<Options> = {}) {
  const types: ArtifactType[] = [];
  const ready: Array<{ version: number; credits: number }> = [];
  const inlined: Array<InlineArtifactResult | undefined> = [];
  let terminalFailures = 0;
  const options: Options = {
    runId: "run-1",
    enabled: true,
    onType: (type) => { types.push(type); },
    artifactId: "artifact-1",
    onArtifactReady: async (version, credits, inline) => {
      ready.push({ version, credits });
      inlined.push(inline);
    },
    onTerminalFailure: () => { terminalFailures += 1; },
    ...overrides,
  };
  const hook = renderHook((props: Options) => useArtifactRun(props), { initialProps: options });
  return {
    hook,
    /** Re-renders with these options changed from the initial ones. */
    rerender: (changes: Partial<Options>) => hook.rerender({ ...options, ...changes }),
    types,
    ready,
    inlined,
    get terminalFailures() { return terminalFailures; },
    stream: () => FakeEventSource.latest(),
  };
}

const started = { seq: 1, ts: 1, kind: "INITIAL", type: "POST", steps: ["RESEARCH", "GENERATE"] };

describe("useArtifactRun", () => {
  test("opens the run stream on first render when a run id is present", () => {
    const { hook } = renderArtifactRun();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest()?.url).toBe(`${API_BASE}/runs/run-1/events`);
    expect(FakeEventSource.latest()?.withCredentials).toBe(true);
    expect(hook.result.current.run?.status).toBe("connecting");
  });

  test("opens nothing without a run id", () => {
    const { hook } = renderArtifactRun({ runId: undefined });

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(hook.result.current.run).toBeNull();
  });

  test("opens nothing while disabled", () => {
    renderArtifactRun({ enabled: false });

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  test("tracks steps and credits from progress events, ignoring stale ones", () => {
    const harness = renderArtifactRun();
    const stream = harness.stream()!;

    act(() => {
      stream.open();
      stream.emit("run.started", started);
      stream.emit("step.started", { seq: 2, ts: 2, step: "RESEARCH", index: 0, total: 2 });
      stream.emit("step.progress", { seq: 3, ts: 3, step: "RESEARCH", sourcesFound: 4 });
      stream.emit("usage.tick", { seq: 4, ts: 4, kind: "llm", credits: 2, totalCredits: 2 });
      stream.emit("step.completed", { seq: 5, ts: 5, step: "RESEARCH", index: 0, total: 2 });
      // A replayed event (seq not above the last one) is dropped.
      stream.emit("step.started", { seq: 5, ts: 6, step: "GENERATE", index: 1, total: 2 });
    });

    const run = harness.hook.result.current.run;
    expect(harness.types).toEqual(["POST"]);
    expect(run?.status).toBe("running");
    expect(run?.sourcesFound).toBe(4);
    expect(run?.credits).toBe(2);
    expect(run?.steps).toEqual([
      { step: "RESEARCH", status: "completed", message: undefined },
      { step: "GENERATE", status: "pending" },
    ]);
  });

  test("shows reconnecting when the connection drops mid-run", () => {
    const harness = renderArtifactRun();

    act(() => {
      harness.stream()!.open();
      harness.stream()!.fail();
    });

    expect(harness.hook.result.current.run?.status).toBe("reconnecting");
  });

  test("closes the stream and loads the version on run.completed", async () => {
    const harness = renderArtifactRun();
    const stream = harness.stream()!;

    await act(async () => {
      stream.emit("run.started", started);
      stream.emit("usage.tick", { seq: 2, ts: 2, kind: "llm", credits: 3, totalCredits: 3 });
      stream.emit("run.completed", { seq: 3, ts: 3, artifactId: "artifact-1", version: 1 });
    });

    expect(stream.closed).toBe(true);
    expect(harness.ready).toEqual([{ version: 1, credits: 3 }]);
    expect(harness.hook.result.current.run).toBeNull();
  });

  test("closes the stream and reports the failure on run.failed", () => {
    const harness = renderArtifactRun();
    const stream = harness.stream()!;

    act(() => {
      stream.emit("run.started", started);
      stream.emit("run.failed", { seq: 2, ts: 2, code: "internal", failureReason: "Boom." });
    });

    const run = harness.hook.result.current.run;
    expect(stream.closed).toBe(true);
    expect(harness.terminalFailures).toBe(1);
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toBe("Boom.");
    expect(run?.failureAction).toBe("retry-create");
  });

  test("closes the stream when the run id is cleared", () => {
    const harness = renderArtifactRun();
    const stream = harness.stream()!;

    harness.rerender({ runId: undefined });

    expect(stream.closed).toBe(true);
  });

  describe("run.completed carrying content", () => {
    const content = { commentary: "Hello" };
    const complete = async (extra: Record<string, unknown>, startedEvent: Record<string, unknown> = started) => {
      const harness = renderArtifactRun();
      await act(async () => {
        harness.stream()!.emit("run.started", startedEvent);
        harness.stream()!.emit("run.completed", {
          seq: 2, ts: Date.now(), artifactId: "artifact-1", version: 1, ...extra,
        });
      });
      return harness;
    };

    test("hands a live POST completion's content on without a read", async () => {
      const harness = await complete({ content, title: " A title " });

      expect(harness.inlined).toEqual([
        { artifactId: "artifact-1", type: "POST", content, title: "A title" },
      ]);
    });

    test("falls back to the read when the event has no content (snapshot)", async () => {
      const harness = await complete({});

      expect(harness.ready).toHaveLength(1);
      expect(harness.inlined).toEqual([undefined]);
    });

    test("falls back to the read for a replayed completion", async () => {
      const harness = await complete({ content, title: "T", ts: Date.now() - 120_000 });

      expect(harness.inlined).toEqual([undefined]);
    });

    test("falls back to the read for another artifact", async () => {
      const harness = await complete({ content, title: "T", artifactId: "artifact-2" });

      expect(harness.inlined).toEqual([undefined]);
    });

    test("falls back to the read when an INITIAL completion has no title", async () => {
      const harness = await complete({ content });

      expect(harness.inlined).toEqual([undefined]);
    });

    test("falls back to the read when the content does not match the run type", async () => {
      const harness = await complete({ content, title: "T" }, { ...started, type: "POLL" });

      expect(harness.inlined).toEqual([undefined]);
    });

    test("falls back to the read for a DOCUMENT run", async () => {
      const harness = await complete({ content, title: "T" }, { ...started, type: "DOCUMENT" });

      expect(harness.inlined).toEqual([undefined]);
    });

    test("accepts a REFINE completion without a title", async () => {
      const harness = await complete({ content }, { ...started, kind: "REFINE" });

      expect(harness.inlined).toEqual([{ artifactId: "artifact-1", type: "POST", content }]);
    });

    test("reads the version when showing the inline copy fails", async () => {
      const calls: Array<InlineArtifactResult | undefined> = [];
      const harness = renderArtifactRun({
        onArtifactReady: async (_version, _credits, inline) => {
          calls.push(inline);
          if (inline) throw new Error("render failed");
        },
      });

      await act(async () => {
        harness.stream()!.emit("run.started", started);
        harness.stream()!.emit("run.completed", {
          seq: 2, ts: Date.now(), artifactId: "artifact-1", version: 1, content, title: "T",
        });
      });

      expect(calls.map(Boolean)).toEqual([true, false]);
      expect(harness.hook.result.current.run).toBeNull();
    });
  });
});

describe("useArtifactRun draft commentary", () => {
  const writing = (seq: number, commentary: string) => ({
    seq,
    ts: seq,
    step: "GENERATE",
    phase: "writing",
    partial: { commentary },
  });

  test("shows the latest streamed commentary while the run writes", () => {
    const harness = renderArtifactRun();
    const stream = harness.stream()!;

    act(() => {
      stream.emit("run.started", started);
      stream.emit("step.progress", writing(2, "Write"));
      stream.emit("step.progress", writing(3, "Write more,\nship more."));
    });

    expect(harness.hook.result.current.run?.draftCommentary).toBe("Write more,\nship more.");
  });

  test("clears the preview on a rewrite", () => {
    const harness = renderArtifactRun();
    const stream = harness.stream()!;

    act(() => {
      stream.emit("run.started", started);
      stream.emit("step.progress", writing(2, "Bad draft"));
      stream.emit("step.progress", { seq: 3, ts: 3, step: "GENERATE", phase: "rewrite" });
    });

    expect(harness.hook.result.current.run?.draftCommentary).toBeUndefined();
  });

  test("clears the preview when a step fails and will retry", () => {
    const harness = renderArtifactRun();
    const stream = harness.stream()!;

    act(() => {
      stream.emit("run.started", started);
      stream.emit("step.progress", writing(2, "Half a dra"));
      stream.emit("step.failed", { seq: 3, ts: 3, step: "GENERATE", retryable: true, message: "Blip" });
    });

    expect(harness.hook.result.current.run?.draftCommentary).toBeUndefined();
  });

  test("keeps the preview until the artifact is ready, then drops it with the run", async () => {
    let finishLoad: () => void = () => {};
    const harness = renderArtifactRun({
      onArtifactReady: () => new Promise<void>((resolve) => { finishLoad = resolve; }),
    });
    const stream = harness.stream()!;

    await act(async () => {
      stream.emit("run.started", started);
      stream.emit("step.progress", writing(2, "Final words."));
      stream.emit("run.completed", { seq: 3, ts: 3, artifactId: "artifact-1", version: 1 });
    });
    expect(harness.hook.result.current.run?.status).toBe("loading-result");
    expect(harness.hook.result.current.run?.draftCommentary).toBe("Final words.");

    await act(async () => { finishLoad(); });

    expect(harness.hook.result.current.run).toBeNull();
  });

  test("ignores a progress event whose partial is not commentary text", () => {
    const harness = renderArtifactRun();
    const stream = harness.stream()!;

    act(() => {
      stream.emit("run.started", started);
      stream.emit("step.progress", { seq: 2, ts: 2, step: "GENERATE", phase: "writing", partial: {} });
    });

    expect(harness.hook.result.current.run?.draftCommentary).toBeUndefined();
  });
});
