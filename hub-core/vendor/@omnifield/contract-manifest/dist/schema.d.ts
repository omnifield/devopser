import { z } from 'zod';
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
export declare const API_VERSION: "omnifield.dev/v1";
export declare const ProductType: z.ZodEnum<["frontend", "backend", "fullstack", "service"]>;
export type ProductType = z.infer<typeof ProductType>;
/** Один шлюзо-видимый маршрут. НЕ описывает lifecycle сервиса — только как достучаться. */
export declare const Route: z.ZodObject<{
    path: z.ZodString;
    port: z.ZodNumber;
    service: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    path: string;
    port: number;
    service?: string | undefined;
}, {
    path: string;
    port: number;
    service?: string | undefined;
}>;
export type Route = z.infer<typeof Route>;
export declare const Integration: z.ZodObject<{
    scopes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    spawnEligible: z.ZodDefault<z.ZodBoolean>;
    deps: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strict", z.ZodTypeAny, {
    scopes: string[];
    spawnEligible: boolean;
    deps: string[];
}, {
    scopes?: string[] | undefined;
    spawnEligible?: boolean | undefined;
    deps?: string[] | undefined;
}>;
export type Integration = z.infer<typeof Integration>;
export declare const ProductManifest: z.ZodEffects<z.ZodObject<{
    apiVersion: z.ZodLiteral<"omnifield.dev/v1">;
    name: z.ZodString;
    type: z.ZodEnum<["frontend", "backend", "fullstack", "service"]>;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    reach: z.ZodOptional<z.ZodObject<{
        routes: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            port: z.ZodNumber;
            service: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            path: string;
            port: number;
            service?: string | undefined;
        }, {
            path: string;
            port: number;
            service?: string | undefined;
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        routes: {
            path: string;
            port: number;
            service?: string | undefined;
        }[];
    }, {
        routes: {
            path: string;
            port: number;
            service?: string | undefined;
        }[];
    }>>;
    integration: z.ZodDefault<z.ZodObject<{
        scopes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        spawnEligible: z.ZodDefault<z.ZodBoolean>;
        deps: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        scopes: string[];
        spawnEligible: boolean;
        deps: string[];
    }, {
        scopes?: string[] | undefined;
        spawnEligible?: boolean | undefined;
        deps?: string[] | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    type: "frontend" | "backend" | "fullstack" | "service";
    apiVersion: "omnifield.dev/v1";
    name: string;
    integration: {
        scopes: string[];
        spawnEligible: boolean;
        deps: string[];
    };
    title?: string | undefined;
    description?: string | undefined;
    reach?: {
        routes: {
            path: string;
            port: number;
            service?: string | undefined;
        }[];
    } | undefined;
}, {
    type: "frontend" | "backend" | "fullstack" | "service";
    apiVersion: "omnifield.dev/v1";
    name: string;
    title?: string | undefined;
    description?: string | undefined;
    reach?: {
        routes: {
            path: string;
            port: number;
            service?: string | undefined;
        }[];
    } | undefined;
    integration?: {
        scopes?: string[] | undefined;
        spawnEligible?: boolean | undefined;
        deps?: string[] | undefined;
    } | undefined;
}>, {
    type: "frontend" | "backend" | "fullstack" | "service";
    apiVersion: "omnifield.dev/v1";
    name: string;
    integration: {
        scopes: string[];
        spawnEligible: boolean;
        deps: string[];
    };
    title?: string | undefined;
    description?: string | undefined;
    reach?: {
        routes: {
            path: string;
            port: number;
            service?: string | undefined;
        }[];
    } | undefined;
}, {
    type: "frontend" | "backend" | "fullstack" | "service";
    apiVersion: "omnifield.dev/v1";
    name: string;
    title?: string | undefined;
    description?: string | undefined;
    reach?: {
        routes: {
            path: string;
            port: number;
            service?: string | undefined;
        }[];
    } | undefined;
    integration?: {
        scopes?: string[] | undefined;
        spawnEligible?: boolean | undefined;
        deps?: string[] | undefined;
    } | undefined;
}>;
/** Единственный источник доменного типа манифеста (канон types-from-zod). */
export type ProductManifest = z.infer<typeof ProductManifest>;
//# sourceMappingURL=schema.d.ts.map