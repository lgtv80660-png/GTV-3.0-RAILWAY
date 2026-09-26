import type { Metadata } from "next";

export const metadata: Metadata = { title: "GTV 3.0 Backend" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
