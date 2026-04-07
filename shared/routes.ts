import { z } from 'zod';
import { insertOrderSchema, updateOrderSchema, updateExternalResponseSchema, orders, users } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
  serverError: z.object({
    message: z.string(),
  })
};

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/login',
      input: z.object({
        username: z.string(),
        password: z.string(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    },
    logout: {
      method: 'POST' as const,
      path: '/api/logout',
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
    me: {
      method: 'GET' as const,
      path: '/api/user',
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    },
  },
  users: {
    list: {
      method: 'GET' as const,
      path: '/api/users',
      responses: {
        200: z.array(z.custom<typeof users.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/users',
      input: z.object({
        username: z.string(),
        password: z.string(),
        role: z.string(),
      }),
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
        403: errorSchemas.unauthorized,
      },
    },
    changePassword: {
      method: 'PUT' as const,
      path: '/api/users/password',
      input: z.object({
        currentPassword: z.string(),
        newPassword: z.string(),
      }),
      responses: {
        200: z.object({ message: z.string() }),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/users/:id',
      responses: {
        200: z.object({ message: z.string() }),
        400: errorSchemas.validation,
        403: errorSchemas.unauthorized,
        404: errorSchemas.validation,
      },
    },
    suspend: {
      method: 'PUT' as const,
      path: '/api/users/:id/suspend',
      input: z.object({
        suspended: z.boolean(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
        403: errorSchemas.unauthorized,
        404: errorSchemas.validation,
      },
    },
  },
  orders: {
    list: {
      method: 'GET' as const,
      path: '/api/orders',
      responses: {
        200: z.array(z.custom<typeof orders.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/orders',
      input: insertOrderSchema,
      responses: {
        201: z.custom<typeof orders.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/orders/:id',
      input: updateOrderSchema,
      responses: {
        200: z.custom<typeof orders.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.validation,
      },
    },
    resetTechResponse: {
      method: 'POST' as const,
      path: '/api/orders/:id/reset',
      responses: {
        200: z.custom<typeof orders.$inferSelect>(),
        403: errorSchemas.unauthorized,
        404: errorSchemas.validation,
      },
    },
    updateContractStatus: {
      method: 'PUT' as const,
      path: '/api/orders/:id/contract',
      input: z.object({
        contractStatus: z.string(),
      }),
      responses: {
        200: z.custom<typeof orders.$inferSelect>(),
        400: errorSchemas.validation,
        403: errorSchemas.unauthorized,
        404: errorSchemas.validation,
      },
    },
    requestExternalReview: {
      method: 'POST' as const,
      path: '/api/orders/:id/external-review',
      responses: {
        200: z.custom<typeof orders.$inferSelect>(),
        400: errorSchemas.validation,
        403: errorSchemas.unauthorized,
        404: errorSchemas.validation,
      },
    },
    externalResponse: {
      method: 'PUT' as const,
      path: '/api/orders/:id/external-response',
      input: updateExternalResponseSchema,
      responses: {
        200: z.custom<typeof orders.$inferSelect>(),
        400: errorSchemas.validation,
        403: errorSchemas.unauthorized,
        404: errorSchemas.validation,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
