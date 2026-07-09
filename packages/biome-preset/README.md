# @omnifield/biome-preset — biome-пресет уровня экосистемы

База для продукт-репо: recommended-правила, formatter (lf / 100 / 2 space / double
quotes), organizeImports. Потребитель держит в root `biome.json` только `extends`
+ свои `files.includes` и легитимные оверрайды (weber-фреймворк издаёт свой пресет
для потребителей фреймворка — не конфликтует, ставится поверх).

```json
{
  "extends": ["@omnifield/biome-preset/biome.json"],
  "files": { "includes": ["**", "!**/dist", "!**/node_modules"] }
}
```

## Заметки потребителю

- **Codegen-артефакты исключать из `files.includes`** (feedback brainer П5:
  формат-чек начинает видеть генерённые файлы — codegen output принадлежит
  генератору, не линтеру): `"!**/<путь-codegen>"`.
- Biome ≥2.5: `linter.rules.preset: "recommended"` (старое `recommended: true`
  deprecated) — в пресете уже так.
