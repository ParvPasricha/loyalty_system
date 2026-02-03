import type { ReactNode } from "react";

export const metadata = {
  title: "Staff Terminal",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: 24 }}>{children}</body>
    </html>
  );
}
