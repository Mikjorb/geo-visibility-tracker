import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEO Visibility Tracker — Visibilidad de marca en IA",
  description: "Monitoriza cómo te mencionan los LLMs frente a tus competidores.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            ⚡ GEO Visibility Tracker
          </Link>
          <nav>
            <Link href="/">Recomendaciones</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/runs">Respuestas</Link>
            <Link href="/prompts">Configuración</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
