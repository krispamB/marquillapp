import { useState, useEffect } from "react";
import { X, Check, XCircle } from "lucide-react";
import { PillButton, CustomSelect, type SelectOption } from "./components";

const BUG_REPORT_OPTIONS: SelectOption[] = [
  { value: "Report a bug", label: "Report a bug" },
  { value: "Request a feature", label: "Request a feature" },
];

interface DeviceReport {
  browser: string;
  os: string;
  screenResolution: string;
  viewportSize: string;
  language: string;
}

async function getDeviceReport(): Promise<DeviceReport> {
  let browser = 'Unknown';
  let os = 'Unknown';

  // 1. Try Modern Client Hints (More accurate for Chrome/Edge/Brave)
  if ('userAgentData' in navigator) {
    const data = (navigator as any).userAgentData;
    browser = data.brands.map((b: any) => `${b.brand} ${b.version}`).join(', ');
    os = data.platform;
  } else {
    // 2. Fallback to Legacy User Agent
    browser = navigator.userAgent;
    os = navigator.platform;
  }

  return {
    browser,
    os,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language
  };
}

type ModalState = "form" | "submitting" | "success" | "error";

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BugReportModal({ isOpen, onClose }: BugReportModalProps) {
  const [modalState, setModalState] = useState<ModalState>("form");
  const [type, setType] = useState("Report a bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("Error 500 | Internal server error");

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setModalState("form");
      setTitle("");
      setDescription("");
      setType("Report a bug");
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    
    setModalState("submitting");

    try {
      const deviceReport = await getDeviceReport();
      const payloadType = type === "Report a bug" ? "BUG" : "FEATURE_REQUEST";
      
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";
      const res = await fetch(`${apiBase}/feedback/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: payloadType,
          title: title.trim(),
          description: description.trim(),
          deviceReport
        })
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.message || `Error ${res.status} | Internal server error`);
      }

      setIssueUrl(json.data?.issueUrl || "");
      setModalState("success");
    } catch (err: any) {
      setErrorMessage(err.message || "Error 500 | Internal server error");
      setModalState("error");
    }
  };

  const renderForm = () => (
    <>
      <h2 className="text-xl font-bold text-slate-800 tracking-tight text-center mt-2 mb-8">
        Report a bug or request a feature
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-2">I would like to</label>
          <CustomSelect
            value={type}
            onChange={(val) => setType(val)}
            options={BUG_REPORT_OPTIONS}
            className="w-full sm:w-[220px]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-2">Title</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a title"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 placeholder:text-slate-300 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-2">Description</label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter a description"
            rows={4}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 placeholder:text-slate-300 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div className="mt-4 flex justify-center">
          <PillButton
            type="submit"
            disabled={modalState === "submitting" || !title.trim() || !description.trim()}
            variant="primary"
            className="px-10 py-3 text-sm tracking-wide bg-blue-500 hover:bg-blue-600 shadow-[0_8px_20px_-8px_rgba(59,130,246,0.6)]"
          >
            {modalState === "submitting" ? "SUBMITTING..." : "SUBMIT"}
          </PillButton>
        </div>
      </form>
    </>
  );

  const renderSuccess = () => (
    <div className="flex flex-col items-center justify-center text-center py-6 px-4">
      <div className="mb-6 grid h-14 w-14 place-items-center rounded-full bg-white shadow-[0_8px_16px_-6px_rgba(0,0,0,0.1)]">
        <Check className="h-6 w-6 text-emerald-500" strokeWidth={3} />
      </div>
      
      <h2 className="mb-4 text-xl font-bold text-slate-800">Success!</h2>
      
      <p className="mb-8 text-sm font-medium text-slate-500 max-w-[260px] leading-relaxed">
        Your <strong className="text-slate-700 font-bold">{type === "Report a bug" ? "bug report" : "feature"}</strong> request has been submitted successfully!
      </p>

      <div className="w-full rounded-xl bg-slate-50 py-4 px-6 text-sm font-medium text-slate-600">
        You can <a href={issueUrl || "#"} target={issueUrl ? "_blank" : undefined} rel={issueUrl ? "noopener noreferrer" : undefined} className="text-indigo-500 hover:text-indigo-600 font-semibold underline decoration-2 underline-offset-2">click here</a> to track the status of your request.
      </div>
    </div>
  );

  const renderError = () => (
    <div className="flex flex-col items-center justify-center text-center py-6 px-4">
      <div className="mb-6 grid h-14 w-14 place-items-center rounded-full bg-white shadow-[0_8px_16px_-6px_rgba(0,0,0,0.1)]">
        <X className="h-6 w-6 text-rose-500" strokeWidth={3} />
      </div>
      
      <h2 className="mb-4 text-xl font-bold text-slate-800">Failed!</h2>
      
      <p className="mb-8 text-sm font-medium text-slate-500 max-w-[260px] leading-relaxed">
        Sorry, it seems your request failed.
      </p>

      <div className="w-full rounded-xl bg-slate-50 p-4 text-sm font-medium text-slate-600 mb-8 border border-slate-100 flex items-center justify-center text-center">
        {errorMessage}
      </div>

      <PillButton
        onClick={() => setModalState("form")}
        variant="primary"
        className="px-10 py-3 text-sm tracking-wide bg-indigo-400 hover:bg-indigo-500 shadow-[0_8px_20px_-8px_rgba(99,102,241,0.5)]"
      >
        TRY AGAIN
      </PillButton>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      
      {/* Modal Card */}
      <div className="relative z-10 w-full max-w-[480px] rounded-2xl bg-white p-8 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.3)] transform transition-all">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-5 top-5 flex flex-col items-center justify-center text-slate-300 hover:text-slate-500 transition-colors bg-transparent border-none outline-none"
        >
          <X className="h-5 w-5 mb-0.5" strokeWidth={2} />
          <span className="text-[9px] font-bold tracking-wider opacity-80">ESC</span>
        </button>

        {modalState === "form" || modalState === "submitting" ? renderForm() : null}
        {modalState === "success" ? renderSuccess() : null}
        {modalState === "error" ? renderError() : null}
      </div>
    </div>
  );
}
