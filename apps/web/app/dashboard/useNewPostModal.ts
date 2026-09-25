"use client";

import { useCallback, useState } from "react";

export type NewPostMode = "create" | "edit";

export type NewPostModalState = {
  isOpen: boolean;
  mode: NewPostMode;
  postId?: string;
  initialContent?: string;
  initialImageUrl?: string;
};

export type OpenEditOptions = {
  postId: string;
  initialContent?: string;
  initialImageUrl?: string;
};

const defaultState: NewPostModalState = {
  isOpen: false,
  mode: "create",
};

export function useNewPostModal() {
  const [state, setState] = useState<NewPostModalState>(defaultState);

  const openCreate = useCallback(() => {
    setState({
      isOpen: true,
      mode: "create",
      postId: undefined,
      initialContent: "",
      initialImageUrl: undefined,
    });
  }, []);

  const openEdit = useCallback((options: OpenEditOptions) => {
    setState({
      isOpen: true,
      mode: "edit",
      postId: options.postId,
      initialContent: options.initialContent ?? "",
      initialImageUrl: options.initialImageUrl,
    });
  }, []);

  const close = useCallback(() => {
    setState((current) => ({ ...current, isOpen: false }));
  }, []);

  return {
    state,
    openCreate,
    openEdit,
    close,
  };
}
