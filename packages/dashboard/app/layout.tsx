import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "linkedin-engine",
  description: "Run health for the open-source agent that writes voice-faithful LinkedIn drafts.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
