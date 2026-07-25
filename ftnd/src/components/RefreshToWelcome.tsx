"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * The roadshow always begins from the welcome screen after a browser refresh.
 * Client-side navigation remains unchanged, so presenters can still move
 * naturally through the experience without being sent back to the beginning.
 */
export default function RefreshToWelcome() {
  const pathname = usePathname();
  const router = useRouter();
  const checkedInitialLoad = useRef(false);

  useEffect(() => {
    if (checkedInitialLoad.current) return;
    checkedInitialLoad.current = true;

    const navigationEntry = performance
      .getEntriesByType("navigation")
      .at(0) as PerformanceNavigationTiming | undefined;

    if (pathname !== "/" && navigationEntry?.type === "reload") {
      router.replace("/");
    }
  }, [pathname, router]);

  return null;
}
