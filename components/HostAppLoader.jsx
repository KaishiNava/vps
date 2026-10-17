"use client";

import dynamic from "next/dynamic";

// HostApp uses xterm, which depends on browser globals such as `self`.
// Keep the whole panel out of server-side rendering/prerendering.
const HostApp = dynamic(() => import("./HostApp"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#06090d",
        color: "#62f6a6",
        fontFamily: "monospace",
      }}
    >
      INITIALIZING FRANX HOST...
    </div>
  ),
});

export default function HostAppLoader() {
  return <HostApp />;
}
