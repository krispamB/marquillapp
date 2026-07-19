import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { useEffect, type ReactNode } from "react";

type DocumentMode = "loading" | "success" | "error";
let documentMode: DocumentMode = "success";
let shouldFailPageRender = false;
let scrollCalls: ScrollToOptions[] = [];

mock.module("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
  Document: ({
    children,
    loading,
    onLoadSuccess,
    onLoadError,
  }: {
    children?: ReactNode;
    loading?: ReactNode;
    onLoadSuccess?: (pdf: { numPages: number }) => void;
    onLoadError?: (error: Error) => void;
  }) => {
    useEffect(() => {
      if (documentMode === "success") onLoadSuccess?.({ numPages: 3 });
      if (documentMode === "error") onLoadError?.(new Error("CORS blocked the PDF"));
    }, [onLoadError, onLoadSuccess]);
    return <div>{documentMode === "loading" ? loading : children}</div>;
  },
  Page: ({
    pageNumber,
    onRenderError,
  }: {
    pageNumber: number;
    onRenderError?: (error: Error) => void;
  }) => {
    useEffect(() => {
      if (shouldFailPageRender) onRenderError?.(new Error(`Unable to render page ${pageNumber}`));
    }, [onRenderError, pageNumber]);
    return <canvas data-page-number={pageNumber} />;
  },
}));

const { default: PdfPreviewRenderer } = await import("./PdfPreviewRenderer");

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

beforeEach(() => {
  documentMode = "success";
  shouldFailPageRender = false;
  scrollCalls = [];
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: (options: ScrollToOptions) => scrollCalls.push(options),
  });
});

describe("PdfPreviewRenderer", () => {
  test("loads pages and navigates within the page boundaries", async () => {
    const onPageChange = mock(() => undefined);
    const view = render(
      <PdfPreviewRenderer
        source="https://files.example/carousel.pdf"
        title="Marketing playbook"
        pageCountHint={3}
        openHref="https://files.example/carousel.pdf"
        onPageChange={onPageChange}
      />,
    );

    await waitFor(() => expect(view.container.querySelectorAll("canvas")).toHaveLength(3));

    view.getAllByLabelText(/Page \d of 3/).forEach((page, index) => {
      const left = 240 + index * 312;
      Object.defineProperty(page, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          bottom: 400,
          height: 400,
          left,
          right: left + 300,
          top: 0,
          width: 300,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }),
      });
    });

    const previous = view.getByRole("button", { name: "Previous PDF page" }) as HTMLButtonElement;
    const next = view.getByRole("button", { name: "Next PDF page" }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    expect(view.getByText("1 / 3")).toBeTruthy();

    fireEvent.click(next);
    expect(view.getByText("2 / 3")).toBeTruthy();
    expect(scrollCalls.at(-1)).toEqual({ left: 312, behavior: "smooth" });
    fireEvent.click(next);
    expect(view.getByText("3 / 3")).toBeTruthy();
    expect(next.disabled).toBe(true);
    expect(onPageChange).toHaveBeenCalledWith(3, 3);

    const openLink = view.getByRole("link", { name: /open pdf/i });
    expect(openLink.getAttribute("href")).toBe("https://files.example/carousel.pdf");
    expect(openLink.getAttribute("target")).toBe("_blank");
  });

  test("shows loading metadata while the document is pending", () => {
    documentMode = "loading";
    const view = render(
      <PdfPreviewRenderer source="pending.pdf" title="Pending carousel" pageCountHint={6} />,
    );

    expect(view.getByText("Loading PDF · 6 pages…")).toBeTruthy();
    expect(view.getByText("6 pages · PDF")).toBeTruthy();
  });

  test("offers retry and the original PDF link after a load error", async () => {
    documentMode = "error";
    const view = render(
      <PdfPreviewRenderer source="broken.pdf" openHref="broken.pdf" />,
    );

    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    expect(view.getByText("CORS blocked the PDF")).toBeTruthy();

    documentMode = "success";
    fireEvent.click(view.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(view.container.querySelectorAll("canvas")).toHaveLength(3));
  });

  test("promotes page render failures into the retryable viewer error", async () => {
    shouldFailPageRender = true;
    const view = render(
      <PdfPreviewRenderer source="render-error.pdf" openHref="render-error.pdf" />,
    );

    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    expect(view.getByText(/Unable to render page [1-3]/)).toBeTruthy();
    expect(view.getByRole("link", { name: /open pdf/i })).toBeTruthy();

    shouldFailPageRender = false;
    fireEvent.click(view.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(view.container.querySelectorAll("canvas")).toHaveLength(3));
  });
});
