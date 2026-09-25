# Project Rules & Guidelines

## Tech Stack
- **Framework**: NestJS v11
- **Language**: TypeScript v5.7 (Target ES2023, Module NodeNext)
- **Package Manager**: NPM
- **Queues**: BullMQ
- **Validation**: Zod & Class-Validator
- **Formatting**: Prettier
- **Linting**: ESLint

## Naming Conventions
- **Files**: Kebab-case (e.g., `agent.controller.ts`, `agent.interface.ts`)
- **Classes**: PascalCase (e.g., `AgentController`, `AgentService`)
- **Interfaces**: PascalCase, **NO** `I` prefix (e.g., `YoutubeSearchResult`, `UserIntent`)
- **Variables/Functions**: CamelCase

## Project Structure
- **Source Root**: `src/`
- **Global Entry**: `src/main.ts`
- **Global Prefix**: `api/v1`
- **Modules**: Feature-based separation (e.g., `agent`, `actors`, `workflow`)
- **DTOs**: Located in `dto/` folder within feature modules.
- **Interfaces**: Located in feature module root or `interfaces/` if shared.
- **Schemas**: Located in `schemas/` folder within feature modules.
- **FileStructure**: Use Barrel expo

## Coding Standards
1.  **Async/Await**: Use `async/await` for asynchronous operations.
2.  **Validation**: 
    - Use `ValidationPipe` globally (configured in `main.ts`).
    - Use DTOs with `class-validator` decorators or Zod schemas.
3.  **Configuration**: 
    - Use `@nestjs/config` and `.env` files.
    - Do not hardcode secrets or config values.
4.  **Dependency Injection**: Use NestJS DI system. Avoid manual instantiation of services where DI is possible.
5.  **Strict Types**: Avoid `any`. Define interfaces or types for all complex structures.

## Development Workflow
- **Start Dev**: `npm run start:dev`
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Format**: `npm run format`
