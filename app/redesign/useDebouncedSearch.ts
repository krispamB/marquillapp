"use client";

import { useCallback, useEffect, useState } from "react";

export default function useDebouncedSearch(onCommit: () => void, delay = 300) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const nextSearch = searchInput.trim();
    if (nextSearch === search) return;
    const timer = window.setTimeout(() => {
      onCommit();
      setSearch(nextSearch);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [delay, onCommit, search, searchInput]);

  const clearSearch = useCallback(() => {
    setSearchInput("");
    setSearch("");
  }, []);

  return { clearSearch, search, searchInput, setSearchInput };
}
