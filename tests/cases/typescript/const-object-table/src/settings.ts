export interface Settings {
  mode: string;
}

export const ANNOTATED: Settings = { mode: 'a' };

export const CHECKED = { mode: 'b' } satisfies Settings;
