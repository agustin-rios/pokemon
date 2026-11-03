# @pokemon/context-pokedex

Contexto hexagonal del Pokédex.

| Capa                  | Contenido                                          | Puede importar              |
| --------------------- | -------------------------------------------------- | --------------------------- |
| `src/domain/`         | entidades y value objects                          | solo relativos              |
| `src/application/`    | ports (interfaces) y casos de uso                  | `domain/`                   |
| `src/infra/adapters/` | implementaciones de los ports (Prisma, en memoria) | además `@pokemon/data-main` |

- `@pokemon/context-pokedex` exporta `domain` + `application`; los adapters, solo por `@pokemon/context-pokedex/adapters`.
- Imports relativos con extensión `.ts` (`module: nodenext` + `allowImportingTsExtensions` en `tsconfig.base.json`).
- Los adapters declaran tipos de retorno del dominio, no los inferidos de Prisma.

Tests: `pnpm nx run @pokemon/context-pokedex:test`.
