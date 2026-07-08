# GEO Visibility Tracker — Servidor MCP (solo lectura)

Expone los datos de visibilidad de marca del tracker como **herramientas MCP**, para
consultarlos desde cualquier cliente compatible (Claude Desktop, Claude Code, etc.) hablando en
lenguaje natural: *"¿cuál es mi Share of Voice?"*, *"dame las recomendaciones GEO"*.

Acceso **directo a Postgres** (no necesita el servidor Next arrancado) y **solo lectura**.

## Herramientas

| Herramienta | Devuelve |
|---|---|
| `get_visibility` | Mention Rate, Citation Rate, AI Visibility Score, posición media |
| `get_share_of_voice` | ranking de menciones: tú vs competidores |
| `get_recommendations` | tareas GEO para ganar visibilidad |
| `get_entities` | grafo de marcas detectadas |
| `get_geo_audit` | auditoría GEO técnica (score, crawlers de IA, llms.txt, recomendaciones) por dominio |
| `list_runs` | últimas ejecuciones |

Todas (salvo `list_runs` y `get_geo_audit`) aceptan un `runId` opcional; por defecto usan la
última ejecución terminada. `get_geo_audit` acepta un `domain` opcional; sin él, devuelve la
última auditoría de cada dominio auditado.

## Configuración

### Claude Desktop — `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "geo-visibility-tracker": {
      "command": "node",
      "args": ["/ruta/absoluta/al/repo/mcp/server.mjs"],
      "env": { "DATABASE_URL": "postgres://usuario:pass@host:6543/db" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add geo-visibility-tracker -- node /ruta/absoluta/al/repo/mcp/server.mjs
```

Si no pasas `DATABASE_URL` en `env`, el servidor lo lee de `.env.local` del repo.

## Probar en local

```bash
npm run mcp   # arranca el servidor por stdio (lo lanza el cliente MCP, no se usa suelto)
```

> **Omnicanal:** este servidor stdio cubre los clientes locales (Claude Desktop/Code). Para acceso
> desde ChatGPT web haría falta exponerlo como MCP remoto (HTTP/SSE); el mismo código de las
> herramientas se reutiliza, solo cambia el transporte.
