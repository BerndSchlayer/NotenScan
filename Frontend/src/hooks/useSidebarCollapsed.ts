import { useEffect, useState } from "react";

export default function useSidebarCollapsed(
  storageKey: string,
  defaultValue?: boolean
): readonly [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return JSON.parse(saved);
    } catch {}
    if (typeof window !== "undefined") {
      try {
        return (
          window.matchMedia && window.matchMedia("(max-width: 1024px)").matches
        );
      } catch {}
    }
    return defaultValue ?? false;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(collapsed));
    } catch {}
  }, [storageKey, collapsed]);

  return [collapsed, setCollapsed] as const;
}
