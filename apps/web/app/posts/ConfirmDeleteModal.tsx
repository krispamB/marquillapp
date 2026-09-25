"use client";

import { AlertTriangle } from "lucide-react";

export function ConfirmDeleteModal({
    isOpen,
    isPublished,
    isDeleting,
    onClose,
    onConfirm,
}: {
    isOpen: boolean;
    isPublished: boolean;
    isDeleting: boolean;
    onClose: () => void;
    onConfirm: () => void;
}) {
    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-2xl">
                <div className="flex flex-col items-center text-center">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                        <AlertTriangle className="h-6 w-6" />
                    </div>
                    <h2 className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                        Delete Post
                    </h2>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                        Are you sure you want to delete this post? This action cannot be undone.
                    </p>
                    {isPublished && (
                        <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3">
                            <p className="text-sm font-medium text-orange-800">
                                Warning: Deleting this published post will also remove it from LinkedIn.
                            </p>
                        </div>
                    )}
                </div>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isDeleting}
                        className="flex-1 rounded-full border border-[var(--color-border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isDeleting}
                        className="flex-1 rounded-full bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                    >
                        {isDeleting ? "Deleting..." : "Delete"}
                    </button>
                </div>
            </div>
        </div>
    );
}
