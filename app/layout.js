import "@xterm/xterm/css/xterm.css";
import "./globals.css";

export const metadata = {
  title: "FRANX HOST — Server Panel",
  description: "Franx Host server management panel"
};

export default function RootLayout({ children }) {
  return <html lang="id"><body>{children}</body></html>;
}
