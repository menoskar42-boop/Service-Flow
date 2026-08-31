import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import type { Express } from "express";
import { calculateTicketBoxScore, registerCfmRoutes } from "./routes";
import { storage } from "./storage";
import { boxKey } from "@shared/cab-norm";

type RouteHandler = (req: any, res: any, next?: (error?: unknown) => void) => unknown;
type RegisteredRoute = {
  method: string;
  path: string;
  handlers: RouteHandler[];
};

const routes: RegisteredRoute[] = [];
const fakeApp = {
  get: (path: string, ...handlers: RouteHandler[]) => routes.push({ method: "GET", path, handlers }),
  post: (path: string, ...handlers: RouteHandler[]) => routes.push({ method: "POST", path, handlers }),
  patch: (path: string, ...handlers: RouteHandler[]) => routes.push({ method: "PATCH", path, handlers }),
  delete: (path: string, ...handlers: RouteHandler[]) => routes.push({ method: "DELETE", path, handlers }),
} as unknown as Express;

const cfmUser = {
  id: "cfm-user-1",
  username: "test-user",
  password: "not-used",
  role: "admin",
  suspended: false,
} as any;

const originalStorageMethods = {
  getUser: storage.getUser,
  getTicketById: storage.getTicketById,
  createWorkEntry: storage.createWorkEntry,
  createUsedTaskEntry: storage.createUsedTaskEntry,
  createInventoryTransaction: storage.createInventoryTransaction,
};

let workEntryWrites = 0;
let usedTaskEntryWrites = 0;
let inventoryTransactionWrites = 0;

before(() => {
  registerCfmRoutes(fakeApp);

  (storage as any).getUser = async () => cfmUser;
  (storage as any).getTicketById = async (id: string) => ({
    id,
    status: "open",
  });
  (storage as any).createWorkEntry = async (entry: any) => {
    workEntryWrites++;
    return { id: "work-entry-1", ...entry };
  };
  (storage as any).createUsedTaskEntry = async (entry: any) => {
    usedTaskEntryWrites++;
    return { id: "used-task-entry-1", ...entry };
  };
  (storage as any).createInventoryTransaction = async () => {
    inventoryTransactionWrites++;
    return { id: "inventory-transaction-1" };
  };
});

after(() => {
  Object.assign(storage, originalStorageMethods);
});

function findRoute(path: string): RegisteredRoute {
  const route = routes.find((candidate) => candidate.method === "POST" && candidate.path === path);
  assert.ok(route, `route ${path} must be registered`);
  return route;
}

async function request(path: string, body: unknown) {
  const route = findRoute(path);
  const req = {
    params: { id: "ticket-1" },
    body,
    session: { cfmUser },
  };
  let statusCode = 200;
  let responseBody: unknown;
  let nextError: unknown;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(bodyValue: unknown) {
      responseBody = bodyValue;
      return this;
    },
  };

  let index = 0;
  const next = (error?: unknown) => {
    if (error) {
      nextError = error;
      return;
    }
    const handler = route.handlers[index++];
    if (handler) void handler(req, res, next);
  };
  next();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(nextError, undefined);
  return { statusCode, body: responseBody };
}

test("work route rejects malformed items before storage", async () => {
  const writesBefore = workEntryWrites;
  const response = await request("/api/cfm/tickets/:id/works", {
    items: [{ id: "item-1", quantity: 3 }],
    performedBy: "technician-1",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(workEntryWrites, writesBefore);
});

test("work route accepts valid items and persists the validated entry", async () => {
  const response = await request("/api/cfm/tickets/:id/works", {
    items: [{ id: "item-1", workTypeId: "work-cable", quantity: 3 }],
    performedBy: "technician-1",
  });

  assert.equal(response.statusCode, 201);
  assert.equal(workEntryWrites, 1);
  assert.deepEqual(response.body, {
    id: "work-entry-1",
    ticketId: "ticket-1",
    items: [{ id: "item-1", workTypeId: "work-cable", quantity: 3 }],
    performedBy: "technician-1",
    createdBy: "cfm-user-1",
  });
});

test("task route rejects malformed items before creating entries or inventory transactions", async () => {
  const entryWritesBefore = usedTaskEntryWrites;
  const transactionWritesBefore = inventoryTransactionWrites;
  const response = await request("/api/cfm/tickets/:id/tasks", {
    items: [{ id: "item-1", taskTypeId: "task-cable" }],
    performedBy: "technician-1",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(usedTaskEntryWrites, entryWritesBefore);
  assert.equal(inventoryTransactionWrites, transactionWritesBefore);
});

test("task route accepts valid items and creates matching inventory transactions", async () => {
  const response = await request("/api/cfm/tickets/:id/tasks", {
    items: [{ id: "item-1", taskTypeId: "task-cable", quantity: 1 }],
    performedBy: "technician-1",
  });

  assert.equal(response.statusCode, 201);
  assert.equal(usedTaskEntryWrites, 1);
  assert.equal(inventoryTransactionWrites, 1);
  assert.deepEqual(response.body, {
    id: "used-task-entry-1",
    ticketId: "ticket-1",
    items: [{ id: "item-1", taskTypeId: "task-cable", quantity: 1 }],
    performedBy: "technician-1",
    createdBy: "cfm-user-1",
  });
});

test("ticket box score averages unique measured lines across wildcard box lists", () => {
  const scoreLines = new Map([
    [boxKey("Central A", "7", "2"), [
      { fullPhone: "p-1", score: 10 },
      { fullPhone: "p-2", score: 30 },
      { fullPhone: "p-invalid", score: 101 },
    ]],
    [boxKey("Central A", "7", "6"), [
      { fullPhone: "p-1", score: 10 },
      { fullPhone: "p-3", score: null },
    ]],
  ]);

  assert.deepEqual(
    calculateTicketBoxScore({
      central: { name: "Central A" },
      cable: { number: "7" },
      box: "2*6",
    }, scoreLines),
    { averageScore: 20, measuredLines: 2 },
  );
});