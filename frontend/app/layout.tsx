import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shaadi HQ — Family wedding planner",
  description: "One calm place for the wedding plan, people, places and details.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
