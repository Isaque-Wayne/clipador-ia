import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "../components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clipador IA",
  description: "Fundação do projeto Clipador IA.",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="pt-BR">
      <body>
        <a href="#main-content" className="skip-link button-primary">Pular para o conteúdo</a>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
