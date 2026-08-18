---
name: asset-generation
description: Generacion y gestion de assets (iconos, imagenes, ilustraciones, sprites). Detecta si hay MCP de assets conectado (fal-ai, openpencil, icon MCP); si no, ofrece conectarlo o usa skill fal-ai-media. Nunca inventa paths.
---
# Asset Generation

## Flujo (siempre)
1. Determinar que asset se necesita (icono, imagen, ilustracion, sprite).
2. Comprobar MCPs de assets conectados (fal-ai, openpencil, icon MCP, pub-mcp).
3. Si hay MCP: usarlo.
4. Si no hay MCP conectado: ofrecer conectarlo a Javier; mientras, usar skill fal-ai-media o asset existente.
5. Verificar que el asset existe en disco (path real); nunca inventar.

## MCPs de assets recomendados
- fal-ai-media (imagenes/video/audio generados).
- openpencil (diseno vectorial AI).
- icon MCP (iconos) o pub-mcp (packages de assets).

## Reglas
- Los assets se guardan en la ruta correcta del proyecto (assets/ o public/).
- Documentar en design.md que assets se usaron y donde.
