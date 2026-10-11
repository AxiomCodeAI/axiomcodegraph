export interface Settings {
  mode: string;
}

export const ANNOTATED: Settings = { mode: 'a' };

export const CHECKED = { mode: 'b' } satisfies Settings;

export type Currency = 'USD' | 'JPY';

export const DIGITS: Readonly<Record<Currency, number>> = { USD: 2, JPY: 0 };
