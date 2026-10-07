export const ROUTES = {
  list: '/items',
  one: '/items/:id',
  admin: { users: '/admin/users', roles: '/admin/roles' },
} as const;

export const handlers = {
  run: () => 1,
};

export const bag: Record<string, number> = {};
bag.late = 1;

export const ADMIN_ROUTES = {
  list: '/admin/items',
} as const;

export const open = { seen: 0 };
(open as Record<string, number>).late = 1;

export const TOKENS = { Relay: Symbol('Relay') } as const;
