"use client";

import { useEffect, useState } from "react";

interface Brand {
  id: number;
  name: string;
  aliases: string[];
  domain: string | null;
  is_own: boolean;
}

// Gestor de marcas (tu marca + competidores). Vive en el Dashboard: definir aquí
// las marcas condiciona directamente las métricas (Share of Voice, menciones).
export default function BrandsManager() {
  const [brands, setBrands] = useState<Brand[] | null>(null);

  async function load() {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    setBrands(cfg.brands ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  async function create(data: Record<string, unknown>) {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "brand", data }),
    });
    if (res.ok) load();
    else alert((await res.json()).error || "Error");
  }

  async function remove(id: number) {
    if (!confirm("¿Eliminar marca?")) return;
    await fetch("/api/config", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "brand", id }),
    });
    load();
  }

  return (
    <div className="panel">
      <h3>Marcas (tú vs competidores)</h3>
      <p style={{ color: "var(--muted)", marginTop: -4, marginBottom: 12, fontSize: 13 }}>
        Define tu marca y los competidores a vigilar. Condiciona el Share of Voice y las menciones.
      </p>
      {!brands ? (
        <p style={{ color: "var(--muted)" }}>Cargando…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Alias</th>
              <th>Dominio</th>
              <th>Tipo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td style={{ color: "var(--muted)" }}>{b.aliases.join(", ")}</td>
                <td style={{ color: "var(--muted)" }}>{b.domain || "—"}</td>
                <td>
                  <span className={`badge ${b.is_own ? "own" : ""}`}>
                    {b.is_own ? "Tu marca" : "Competidor"}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button className="danger" onClick={() => remove(b.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <BrandForm onCreate={create} />
    </div>
  );
}

function BrandForm({ onCreate }: { onCreate: (d: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [domain, setDomain] = useState("");
  const [isOwn, setIsOwn] = useState(false);
  return (
    <div className="row" style={{ marginTop: 16 }}>
      <div style={{ flex: 2 }}>
        <label>Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
      </div>
      <div style={{ flex: 3 }}>
        <label>Alias (separados por coma)</label>
        <input
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="Acme, ACME Corp"
        />
      </div>
      <div style={{ flex: 2 }}>
        <label>Dominio (para citas)</label>
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
      </div>
      <div>
        <label>
          <input
            type="checkbox"
            checked={isOwn}
            onChange={(e) => setIsOwn(e.target.checked)}
            style={{ width: "auto", marginRight: 6 }}
          />
          Es mi marca
        </label>
      </div>
      <button
        onClick={() => {
          if (!name) return;
          onCreate({ name, aliases, domain, is_own: isOwn });
          setName("");
          setAliases("");
          setDomain("");
          setIsOwn(false);
        }}
      >
        Añadir
      </button>
    </div>
  );
}
