// an object literal key bound to an arrow or a function expression
export const Articles = {
  all: (page: number) => request('/articles', page),
  get: function (slug: string) {
    return request('/articles/' + slug, 0);
  },
  // CONTROL: method shorthand already keeps its name
  del(slug: string) {
    return request('/articles/' + slug, -1);
  },
  // a literal nested under a key: owned by the key chain
  tags: {
    list: () => request('/tags', 0),
  },
};

// obj.x = function
export const helpers: any = {};
helpers.titleCase = function (s: string) {
  return s.toUpperCase();
};

// CONTROL: a named function expression keeps its OWN name, not the key's
helpers.alias = function realName(s: string) {
  return s;
};

// CONTROL: an arrow passed as an argument has no name to take
[1, 2].map((n) => request('/n', n));

function request(url: string, arg: number) {
  return url + arg;
}

// a literal under `as const`
export const Routes = {
  home: () => request('/', 0),
} as const;
