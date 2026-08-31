import assert from "node:assert/strict";
import test from "node:test";
import {
  insertUsedTaskEntrySchema,
  insertWorkEntrySchema,
  insertWorkTypeSchema,
} from "../../shared/cfm-schema";

test("accepts a work type with typed associated materials", () => {
  const result = insertWorkTypeSchema.safeParse({
    name: "إصلاح كابل",
    associatedMaterials: [
      { taskTypeId: "task-cable", defaultQuantity: 2 },
    ],
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.associatedMaterials, [
      { taskTypeId: "task-cable", defaultQuantity: 2 },
    ]);
  }
});

test("rejects malformed associated materials", () => {
  const missingTaskType = insertWorkTypeSchema.safeParse({
    name: "إصلاح كابل",
    associatedMaterials: [{ defaultQuantity: 2 }],
  });
  const invalidQuantity = insertWorkTypeSchema.safeParse({
    name: "إصلاح كابل",
    associatedMaterials: [{ taskTypeId: "task-cable", defaultQuantity: "2" }],
  });

  assert.equal(missingTaskType.success, false);
  assert.equal(invalidQuantity.success, false);
});

test("accepts a work entry with typed items", () => {
  const result = insertWorkEntrySchema.safeParse({
    ticketId: "ticket-1",
    items: [
      {
        id: "item-1",
        workTypeId: "work-cable",
        quantity: 3,
        excavationWorkerId: "worker-1",
        excavationLength: 5,
      },
    ],
    performedBy: "technician-1",
    createdBy: "cfm-user-1",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.items[0].workTypeId, "work-cable");
    assert.equal(result.data.items[0].quantity, 3);
  }
});

test("rejects work entry items with missing or invalid fields", () => {
  const missingWorkType = insertWorkEntrySchema.safeParse({
    ticketId: "ticket-1",
    items: [{ id: "item-1", quantity: 3 }],
    performedBy: "technician-1",
    createdBy: "cfm-user-1",
  });
  const invalidQuantity = insertWorkEntrySchema.safeParse({
    ticketId: "ticket-1",
    items: [{ id: "item-1", workTypeId: "work-cable", quantity: "3" }],
    performedBy: "technician-1",
    createdBy: "cfm-user-1",
  });

  assert.equal(missingWorkType.success, false);
  assert.equal(invalidQuantity.success, false);
});

test("accepts and validates used task entry items", () => {
  const valid = insertUsedTaskEntrySchema.safeParse({
    ticketId: "ticket-1",
    items: [{ id: "item-1", taskTypeId: "task-cable", quantity: 1 }],
    performedBy: "technician-1",
    createdBy: "cfm-user-1",
  });
  const invalid = insertUsedTaskEntrySchema.safeParse({
    ticketId: "ticket-1",
    items: [{ id: "item-1", taskTypeId: "task-cable" }],
    performedBy: "technician-1",
    createdBy: "cfm-user-1",
  });

  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});