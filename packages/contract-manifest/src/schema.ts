import { z } from "zod";

/**
 * @omnifield/contract-manifest — тонкий product-manifest контракт.
 *
 * ИСТОЧНИК ПРАВДЫ схемы (канон types-from-zod). Из этой Zod-схемы эмитится
 * `omnifield.schema.json` (scripts/emit-schema.ts) — им валидируют не-JS
 * продукты и подсвечивает редактор. Один авторский источник → один
 * кросс-язычный артефакт. Ноль дрейфа схема↔тип.
 *
 * Нормативная форма — дизайн `briefs/inc1-product-manifest-design.md` §2.
 */

/** Мажор контракта. Смена = major-bump пакета + новый apiVersion (видимый брейк). */
export const API_VERSION = "omnifield.dev/v1" as const;

export const ProductType = z.enum(["frontend", "backend", "fullstack", "service"]);
export type ProductType = z.infer<typeof ProductType>;

/** Один шлюзо-видимый маршрут. НЕ описывает lifecycle сервиса — только как достучаться. */
export const Route = z
  .object({
    path: z.string().startsWith("/"), // location-префикс в gateway (nginx)
    port: z.number().int().positive(), // порт КОНТЕЙНЕРА, отдающий этот путь
    service: z.string().optional(), // имя compose-сервиса, если != name; ТОНКАЯ ссылка, не определение
  })
  .strict();
export type Route = z.infer<typeof Route>;

export const Integration = z
  .object({
    scopes: z.array(z.string()).default([]), // роль-скоупы участия (role-tier, блюпринт §7)
    spawnEligible: z.boolean().default(false), // хаб вправе спавнить агентов в контейнер продукта
    deps: z.array(z.string()).default([]), // имена ДРУГИХ ПРОДУКТОВ (не npm-пакетов)
  })
  .strict();
export type Integration = z.infer<typeof Integration>;

export const ProductManifest = z
  .object({
    apiVersion: z.literal(API_VERSION), // мажор контракта (§5)
    name: z.string().regex(/^[a-z][a-z0-9-]*$/), // уникальный id; = базовое имя compose-сервиса
    type: ProductType,
    title: z.string().optional(), // человекочитаемая метка карты хаба; default = name
    description: z.string().optional(), // подпись карточки хаба
    reach: z
      .object({ routes: z.array(Route).min(1) })
      .strict()
      .optional(),
    integration: Integration.default({ scopes: [], spawnEligible: false, deps: [] }),
  })
  .strict() // ← лишний ключ = ошибка. Утечку расширенного ловит валидатор, не память.
  .superRefine((m, ctx) => {
    const hasUi = m.type === "frontend" || m.type === "fullstack";

    // reach обязателен для того, что вообще ходит через дверь
    if (hasUi && !m.reach) {
      ctx.addIssue({
        code: "custom",
        path: ["reach"],
        message: `type '${m.type}' обязан объявить reach.routes`,
      });
    }

    // Канон UI-входа (knowledger ADR-9 «Фуллстек-UI-вход»): продукт с UI отдаёт
    // его на /<name>/, НЕ через /api/. Дверь ведёт на UI-префикс; /api/ — только API.
    // Отсутствие /<name>-маршрута (в т.ч. когда UI повешен под /api/) = loud fail.
    if (hasUi && m.reach) {
      const uiEntry = `/${m.name}`;
      const hasUiEntry = m.reach.routes.some(
        (r) => r.path === uiEntry || r.path === `${uiEntry}/`,
      );
      if (!hasUiEntry) {
        ctx.addIssue({
          code: "custom",
          path: ["reach", "routes"],
          message:
            `type '${m.type}' обязан отдавать UI-вход на '${uiEntry}/' (маршрут вне /api/) — ` +
            `UI под /api/ запрещён, /api/ только для API (knowledger ADR-9)`,
        });
      }
    }
  });

/** Единственный источник доменного типа манифеста (канон types-from-zod). */
export type ProductManifest = z.infer<typeof ProductManifest>;
