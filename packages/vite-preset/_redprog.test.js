// ВРЕМЕННО: живой прог Foundation Шаг 6 — намеренно красный субстантивный чек,
// доказать, что required-checks блокирует мерж. Этот файл удаляется следующим коммитом.
import { test } from "node:test";
import assert from "node:assert/strict";

test("redprog: намеренный красный (будет удалён)", () => {
  assert.equal(1, 2, "намеренный провал — прог гейта required-checks");
});
